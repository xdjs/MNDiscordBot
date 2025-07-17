import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  Interaction,
  ChatInputCommandInteraction,
} from 'discord.js';
import express from 'express';
import type { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

// Environment variables
const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID; // Optional, speeds up command registration during development

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be provided in the environment.');
}
const supabase = createClient(supabaseUrl, supabaseKey);

// Spotify configuration
const spotifyClientId = process.env.SPOTIFY_CLIENT_ID;
const spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET;
const spotifyRedirectUri = process.env.SPOTIFY_REDIRECT_URI || 'http://localhost:3000/spotify/callback';

if (!spotifyClientId || !spotifyClientSecret) {
  throw new Error('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be provided in the environment.');
}

// Helper to build the Spotify authorisation URL
function generateSpotifyAuthUrl(discordUserId: string): string {
  const scope = encodeURIComponent('user-read-private user-read-email user-top-read');
  const state = encodeURIComponent(discordUserId); // minimal – you can sign/encode this further if desired
  return `https://accounts.spotify.com/authorize?response_type=code&client_id=${spotifyClientId}&scope=${scope}&redirect_uri=${encodeURIComponent(spotifyRedirectUri)}&state=${state}`;
}

if (!token || !clientId) {
  throw new Error(
    'DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID must be provided in the environment (e.g., in a .env file).'
  );
}

// ------------------------------------------------------
// Slash command definitions and REST client
// ------------------------------------------------------
const commands = [
  new SlashCommandBuilder().setName('hi').setDescription('Say hi!'),
  new SlashCommandBuilder().setName('connect').setDescription('Link your Spotify account'),
  new SlashCommandBuilder().setName('tracks').setDescription('Get your top 10 Spotify tracks'),
  new SlashCommandBuilder()
    .setName('listen')
    .setDescription('Start a listening session')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription(
          'The user whose Spotify status to listen to (defaults to yourself)',
        )
        .setRequired(false)
    ),
  new SlashCommandBuilder().setName('chat').setDescription('Prompt questions in #bot-chat'),
  // The /profile command is handled by the Vercel serverless function, not this long-running bot.
  new SlashCommandBuilder().setName('profile').setDescription('Show your profile card'),
].map((c) => c.toJSON());

// Reusable REST instance so we can register commands at runtime (e.g. when joining new guilds)
const rest = new REST({ version: '10' }).setToken(token!);

// Create the client with only the Guilds intent (enough for slash commands)
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`Logged in as ${client.user?.tag}!`);

  // (Commands and REST client are now defined at module scope)

  try {
    console.log('Refreshing application (/) commands...');

    if (guildId) {
      // Register commands for a single guild (instantly available, useful for dev)
      await rest.put(Routes.applicationGuildCommands(clientId!, guildId), {
        body: commands,
      });
      console.log('Successfully registered guild commands.');
    } else {
      // Register global commands (may take up to an hour to appear)
      await rest.put(Routes.applicationCommands(clientId!), { body: commands });
      console.log('Successfully registered global commands.');
    }
  } catch (error) {
    console.error('Failed to register commands:', error);
  }
});

// Register commands immediately when the bot joins a new guild so they are
// available without waiting for the global command propagation delay.
client.on('guildCreate', async (guild) => {
  try {
    await rest.put(Routes.applicationGuildCommands(clientId!, guild.id), { body: commands });
    console.log(`Registered slash commands for new guild "${guild.name}" (${guild.id}).`);
  } catch (error) {
    console.error(`Failed to register commands for guild ${guild.id}:`, error);
  }
});

client.on('interactionCreate', async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'hi') {
    await interaction.reply('Hi! 👋');
  } else if (interaction.commandName === 'connect') {
    await handleConnect(interaction);
  } else if (interaction.commandName === 'tracks') {
    await handleTracks(interaction);
  } else if (interaction.commandName === 'listen') {
    await handleListen(interaction);
  } else if (interaction.commandName === 'chat') {
    await handleChat(interaction);
  }
  // profile command is handled elsewhere
});

// -------------------  /connect command handler  --------------------
async function handleConnect(interaction: ChatInputCommandInteraction) {
  const discordUserId = interaction.user.id;

  // Check if the user already has a row in the existing table
  const { data, error } = await supabase
    .from('spotify_tokens')
    .select('access_token')
    .eq('user_id', discordUserId)
    .maybeSingle();

  if (error) {
    console.error('Supabase lookup error', error);
  }

  if (data) {
    await interaction.reply({
      content: 'You have already connected your Spotify account ✅',
      ephemeral: true,
    });
    return;
  }

  const authUrl = generateSpotifyAuthUrl(discordUserId);

  try {
    await interaction.user.send(
      `To connect your Spotify account, please click the link below and authorise access:\n${authUrl}`
    );

    await interaction.reply({
      content:
        'I\'ve sent you a DM with a link to connect your Spotify account! (Check that your DMs are open.)',
      ephemeral: true,
    });
  } catch (dmError) {
    console.error('Failed to send DM', dmError);
    await interaction.reply({
      content:
        "I couldn't send you a DM. Please make sure your Direct Messages are enabled and try again.",
      ephemeral: true,
    });
  }
}

// -------------------  /tracks command handler  --------------------
async function handleTracks(interaction: ChatInputCommandInteraction) {
  const discordUserId = interaction.user.id;

  // Retrieve user's Spotify tokens
  const { data, error } = await supabase
    .from('spotify_tokens')
    .select('access_token, refresh_token')
    .eq('user_id', discordUserId)
    .maybeSingle();

  if (error) {
    console.error('Supabase lookup error', error);
    await interaction.reply({
      content: 'Sorry, something went wrong while looking up your account.',
      ephemeral: true,
    });
    return;
  }

  if (!data) {
    await interaction.reply({
      content: "You haven't connected your Spotify account yet. Use /connect first!",
      ephemeral: true,
    });
    return;
  }

  let { access_token: accessToken, refresh_token: refreshToken } = data as {
    access_token: string;
    refresh_token: string | null;
  };

  // Helper to call Spotify API
  const fetchTopTracks = async (token: string) => {
    return fetch(
      'https://api.spotify.com/v1/me/top/tracks?limit=10&time_range=medium_term',
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
  };

  let topTracksRes = await fetchTopTracks(accessToken);

  // If the access token is invalid/expired, try to refresh it
  if (topTracksRes.status === 401 && refreshToken) {
    try {
      const params = new URLSearchParams();
      params.append('grant_type', 'refresh_token');
      params.append('refresh_token', refreshToken);

      const basic = Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString('base64');

      const refreshRes = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (refreshRes.ok) {
        const refreshJson = await refreshRes.json();
        accessToken = refreshJson.access_token;

        // Persist the new token
        await supabase
          .from('spotify_tokens')
          .update({
            access_token: accessToken,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', discordUserId);

        // Retry fetching top tracks
        topTracksRes = await fetchTopTracks(accessToken);
      } else {
        console.error('Failed to refresh token', await refreshRes.text());
      }
    } catch (refreshErr) {
      console.error('Error refreshing token', refreshErr);
    }
  }

  if (!topTracksRes.ok) {
    console.error('Spotify top tracks request failed', await topTracksRes.text());
    await interaction.reply({
      content: 'Failed to fetch your top tracks from Spotify. Please try again later.',
      ephemeral: true,
    });
    return;
  }

  const topTracksJson = (await topTracksRes.json()) as { items: any[] };

  const tracksList = topTracksJson.items
    .map(
      (track, idx) =>
        `${idx + 1}. ${track.name} – ${track.artists.map((a: any) => a.name).join(', ')}`
    )
    .join('\n');

  await interaction.reply({
    content: `🎵 **<@${discordUserId}>'s Top 10 Tracks:**\n${tracksList}`,
  });
}

// -------------------  /listen command handler  --------------------
const listenHookUrl = process.env.LISTEN_HOOK_URL;
const musicHookUrl = process.env.MUSIC_HOOK_URL;

async function handleListen(interaction: ChatInputCommandInteraction) {
  const targetUser = interaction.options.getUser('user');
  const isBotTarget = targetUser?.bot ?? false;
  const userId = targetUser ? targetUser.id : interaction.user.id;

  const displayUser = targetUser ? `<@${targetUser.id}>` : 'you';

  // Record trigger row (optional analytics)
  await supabase.from('listen_triggers').insert({
    user_id: userId,
    channel_id: interaction.channelId,
    guild_id: interaction.guildId,
    created_at: new Date().toISOString(),
  });

  // ------------------------------------------------------------
  // If the target is a bot, switch to chat-listening mode instead
  // ------------------------------------------------------------
  if (isBotTarget) {
    if (musicHookUrl) {
      try {
        await fetch(musicHookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel_id: interaction.channelId, bot_id: userId }),
        });
      } catch (err) {
        console.error('Failed to call music webhook', err);
      }
    }

    await interaction.reply({
      content: `🎶 I'll track <@${userId}>'s Now-Playing messages and share fun facts!`,
      ephemeral: true,
    });
    return; // Skip Spotify flow for bots
  }

  // Call Render webhook to validate Spotify presence & send fun fact
  if (listenHookUrl) {
    try {
      await fetch(listenHookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          channel_id: interaction.channelId,
          guild_id: interaction.guildId,
        }),
      });
    } catch (err) {
      console.error('Failed to call listen webhook', err);
    }
  }

  await interaction.reply({
    content: `🎧 Listening session started for ${displayUser}! I'll send you a fun fact soon.`,
    ephemeral: true,
  });
}

// ------------------- /chat command handler --------------------
async function handleChat(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({ content: '⚠️ This command only works inside a server.', ephemeral: true });
    return;
  }

  // Fetch guild channels and look for #bot-chat
  let botChatId: string | null = null;
  try {
    const channels = await client.guilds.cache.get(guildId)?.channels.fetch();
    if (channels) {
      channels.forEach((channel) => {
        if (channel && channel.isTextBased() && (channel as any).name === 'bot-chat') {
          botChatId = channel.id;
        }
      });
    }
  } catch (err) {
    console.error('Error fetching channels', err);
  }

  if (!botChatId) {
    await interaction.reply({ content: '⚠️ Please create a #bot-chat channel first.', ephemeral: true });
    return;
  }

  try {
    const targetChannel = client.channels.cache.get(botChatId ?? '');
    if (targetChannel && targetChannel.isTextBased()) {
      await (targetChannel as any).send('What questions do you have?');
    }
    await interaction.reply({ content: `✅ Prompt posted in #bot-chat!`, ephemeral: true });
  } catch (err) {
    console.error('Failed to send message', err);
    await interaction.reply({ content: 'Failed to post in #bot-chat.', ephemeral: true });
  }
}

// removed handleProfile implementation as rendering handled by Render server

// -------------------  Spotify OAuth callback server  ---------------
const app = express();

app.get('/spotify/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query as { [key: string]: string };

  if (!code || !state) {
    return res.status(400).send('Missing code or state');
  }

  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', spotifyRedirectUri);

    const basic = Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString('base64');

    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const tokenJson = await tokenRes.json();

    if (!tokenRes.ok) {
      console.error('Spotify token exchange failed', tokenJson);
      return res.status(500).send('Failed to exchange token');
    }

    await supabase.from('spotify_tokens').upsert({
      user_id: state,
      access_token: tokenJson.access_token,
      refresh_token: tokenJson.refresh_token,
      updated_at: new Date().toISOString(),
      // keep created_at default, time_range and track_limit unchanged/null
    });

    // Notify user in Discord
    try {
      const user = await client.users.fetch(state);
      await user.send('✅ Your Spotify account has been successfully linked!');
    } catch (fetchErr) {
      console.error('Could not DM user after linking', fetchErr);
    }

    res.send('All set! You can close this tab and return to Discord.');
  } catch (err) {
    console.error('OAuth callback error', err);
    res.status(500).send('Internal server error');
  }
});

const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, () => console.log(`OAuth callback server listening on port ${PORT}`));