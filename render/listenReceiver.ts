import 'dotenv/config';
import express from 'express';
import { REST, Routes } from 'discord.js';
import {
  Client as DiscordClient,
  GatewayIntentBits,
  ActivityType,
  Message,
} from 'discord.js';

// ---------- Profile card generation ----------
import { Canvas, loadImage } from 'skia-canvas';
import { supabase } from '../api/lib/supabase.js';

// ---- In-memory session tracking ----
interface ListenSession {
  channelId: string;
  guildId: string;
  /**
   * The last Spotify track identifier we responded to.
   * Prefer the Spotify `syncId` (unique per track) and fall back to the track title when unavailable.
   */
  lastTrackId: string | null;
  factCount: number;
}

const sessions = new Map<string, ListenSession>(); // key = userId

// ---- Chat session tracking ----
const chatChannels = new Set<string>();
interface ChatSession {
  timeout: NodeJS.Timeout;
}
const chatSessions = new Map<string, ChatSession>(); // key = channelId

// ---- Music bot now-playing tracking ----
interface MusicSession {
  botId: string;
  timeout: NodeJS.Timeout;
}
const musicSessions = new Map<string, MusicSession>(); // key = channelId

function scheduleMusicTimeout(channelId: string) {
  const session = musicSessions.get(channelId);
  if (!session) return;
  clearTimeout(session.timeout);
  const timeout = setTimeout(() => {
    musicSessions.delete(channelId);
    console.log(`Music session for ${channelId} closed due to inactivity.`);
  }, 2 * 60 * 1000);
  session.timeout = timeout;
}

function scheduleChatTimeout(channelId: string) {
  // Clear existing timer if present
  const existing = chatSessions.get(channelId);
  if (existing) {
    clearTimeout(existing.timeout);
  }

  const timeout = setTimeout(async () => {
    chatChannels.delete(channelId);
    chatSessions.delete(channelId);
    try {
      const chan = await client.channels.fetch(channelId);
      if (chan && chan.isTextBased()) {
        await (chan as any).send('⌛ Chat session closed due to inactivity.');
      }
    } catch (err) {
      console.error('Failed to post timeout message', err);
    }
    console.log(`Chat session for ${channelId} closed after inactivity.`);
  }, 2 * 60 * 1000); // 2 minutes

  chatSessions.set(channelId, { timeout });
}

// ---- OpenAI helper ----
const { OPENAI_API_KEY } = process.env;

async function getFunFact(artist: string): Promise<string> {
  if (!OPENAI_API_KEY) return `${artist} is cool!`;

  const prompt = `Generate a random fun fact about the artist ${artist} that would be interesting to both new fans and superfans. 
  This should not be a well-known fact. 
  Do not provide or make up any false information.
  If you cannot find anything then respond with "I'm sorry but I couldn't find anything about ${artist}."`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 50,
        temperature: 0.7,
      }),
    });

    const json = (await res.json()) as any;
    const fact = json.choices?.[0]?.message?.content?.trim();
    return fact || `${artist} is cool!`;
  } catch (err) {
    console.error('OpenAI error', err);
    return `${artist} is cool!`;
  }
}

// ---- OpenAI helper for general chat ----

// ---- OpenAI helper for "now playing" lines from music bots ----
async function getSongFunFact(nowPlayingLine: string): Promise<string> {
  if (!OPENAI_API_KEY) return `${nowPlayingLine} sounds great!`;

  const prompt = `The following Discord message came from a music bot and announces what it is currently playing.\n` +
    `Message: \"${nowPlayingLine}\"\n` +
    `Extract the song (and artist if present) and give me one fun fact about that song in 1-2 sentences. ` +
    `If you cannot identify the song, reply: I'm sorry but I couldn't find anything about that song.`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 60,
        temperature: 0.7,
      }),
    });

    const json = (await res.json()) as any;
    const fact = json.choices?.[0]?.message?.content?.trim();
    return fact || `${nowPlayingLine} sounds great!`;
  } catch (err) {
    console.error('OpenAI song fact error', err);
    return `${nowPlayingLine} sounds great!`;
  }
}

interface SongContext {
  track: string;
  artist: string;
}

async function getChatAnswer(question: string, song?: SongContext): Promise<string> {
  if (!OPENAI_API_KEY) return "I'm offline right now. Try again later!";

  let prompt = `You are a helpful assistant in a Discord channel.`;
  if (song) {
    prompt += ` The user is currently listening to the song "${song.track}" by "${song.artist}". Use this information as context when relevant.`;
  }
  prompt += ` Answer the following question concisely and helpfully. Question: ${question}`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.7,
      }),
    });

    const json = (await res.json()) as any;
    const answer = json.choices?.[0]?.message?.content?.trim();
    return answer || "I'm not sure.";
  } catch (err) {
    console.error('OpenAI chat error', err);
    return "Something went wrong.";
  }
}

const {
  PORT = '8080',
  DISCORD_BOT_TOKEN,
} = process.env;

if (!DISCORD_BOT_TOKEN) {
  throw new Error('DISCORD_BOT_TOKEN is required');
}

const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);

const client = new DiscordClient({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let ready = false;
client.once('ready', () => {
  console.log(`Discord presence client ready as ${client.user?.tag}`);
  ready = true;
});
client.login(DISCORD_BOT_TOKEN);

// Utility to wait until client ready
async function ensureReady() {
  if (ready) return;
  await new Promise((res) => client.once('ready', res));
}

const app = express();
app.use(express.json());

app.post('/listen-hook', async (req, res) => {
  const { user_id: userId, channel_id: channelId, guild_id: guildId } = req.body as {
    user_id?: string;
    channel_id?: string;
    guild_id?: string;
  };

  if (!userId || !channelId || !guildId) {
    return res.status(400).json({ error: 'Missing user_id, channel_id, or guild_id' });
  }

  try {
    await ensureReady();

    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId);
    const hasSpotify = member.presence?.activities.some(
      (a) => a.type === ActivityType.Listening && a.name === 'Spotify'
    );

    if (!hasSpotify) {
      await rest.post(Routes.channelMessages(channelId), {
        body: {
          content:
            `⚠️ <@${userId}>, please enable "Display current activity as a status message" in your Discord settings so I can detect your Spotify activity. If you do have it enabled then please play a song and try again.`,
        },
      });
      return res.json({ status: 'no-spotify' });
    }


    // Proceed if Spotify activity present – grab artist and send fun fact

    const spotifyAct = member.presence?.activities.find(
      (a) => a.type === ActivityType.Listening && a.name === 'Spotify',
    );

    let artistText =
      spotifyAct?.state ||
      spotifyAct?.assets?.largeText?.split(' – ')[0] ||   // "Artist – Track"
      spotifyAct?.details;                                // track title as last resort

    console.log('artistText extracted:', artistText);
    if (artistText) {
      artistText = artistText.split(/[;,]/)[0].trim();
    }
    if (!artistText) artistText = 'Unknown artist';
    const fact = await getFunFact(artistText);

    await rest.post(Routes.channelMessages(channelId), {
      body: {
        content: `🎶 ${fact}`,
        tts: true,
      },
    });

    // Start active session tracking for up to 3 songs
    sessions.set(userId, {
      channelId,
      guildId,
      lastTrackId: (spotifyAct as any)?.syncId ?? spotifyAct?.details ?? null,
      factCount: 1,
    });

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Failed to process listen hook', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---- Chat hook to activate listening on a channel ----
app.post('/chat-hook', (req, res) => {
  const { channel_id: channelId } = req.body as { channel_id?: string };
  if (!channelId) return res.status(400).json({ error: 'Missing channel_id' });

  chatChannels.add(channelId);
  console.log('Chat listening activated for', channelId);
  scheduleChatTimeout(channelId);
  return res.json({ status: 'ok' });
});

// ---- Music hook to track "now playing" messages from a specific bot ----
app.post('/music-hook', (req, res) => {
  const { channel_id: channelId, bot_id: botId } = req.body as {
    channel_id?: string;
    bot_id?: string;
  };
  if (!channelId || !botId) return res.status(400).json({ error: 'Missing channel_id or bot_id' });

  // Clear existing timer if any and set new session
  const existing = musicSessions.get(channelId);
  if (existing) clearTimeout(existing.timeout);

  const timeout = setTimeout(() => {
    musicSessions.delete(channelId);
    console.log(`Music session for ${channelId} closed due to inactivity.`);
  }, 2 * 60 * 1000);

  musicSessions.set(channelId, { botId, timeout });
  console.log('Music listening activated for', channelId, 'bot', botId);
  return res.json({ status: 'ok' });
});

// ---------- Profile card generation ----------
app.post('/profile-hook', async (req, res) => {
  const {
    user_id: userId,
    username,
    avatar,
    application_id: appId,
    interaction_token: token,
  } = req.body as {
    user_id?: string;
    username?: string;
    avatar?: string;
    application_id?: string;
    interaction_token?: string;
  };

  // Optional shared-secret check
  const secret = process.env.PROFILE_HOOK_SECRET;
  if (secret && req.get('x-profile-signature') !== secret) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (!userId || !appId || !token) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const avatarUrl = `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png?size=256`;

  // Upsert into Supabase (fire-and-forget)
  (async () => {
    try {
      await supabase.from('profiles').upsert({
        user_id: userId,
        username: username ?? '',
        avatar_url: avatarUrl,
        updated_at: new Date().toISOString(),
      });
    } catch (e: any) {
      console.error('[profile-hook] Supabase upsert error', e);
    }
  })();

  // Build card
  const width = 550;
  const height = 160;
  const canvas = new Canvas(width, height);
  const ctx: any = canvas.getContext('2d');

  const roundRect = (ctx: any, x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.fill();
  };

  // Background
  ctx.fillStyle = '#1e1e1e';
  roundRect(ctx, 0, 0, width, height, 18);

  // Avatar drawing
  const avatarSize = 116;
  const avatarX = 22;
  const avatarY = (height - avatarSize) / 2;
  try {
    const img = await loadImage(avatarUrl);
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, avatarX, avatarY, avatarSize, avatarSize);
    ctx.restore();
  } catch (err) {
    console.error('[profile-hook] Avatar load error', err);
  }

  // Status circle
  ctx.fillStyle = '#3ba55d';
  const dotR = 12;
  ctx.beginPath();
  ctx.arc(avatarX + avatarSize - dotR, avatarY + avatarSize - dotR, dotR, 0, Math.PI * 2);
  ctx.fill();

  // Username text
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 42px Sans';
  ctx.textBaseline = 'middle';
  ctx.fillText(username ?? 'Unknown', avatarX + avatarSize + 30, height / 2);

  const buffer: Buffer = await (canvas as any).png;

  // Send follow-up message via webhook
  try {
    const form: any = new (globalThis as any).FormData();
    form.append('payload_json', JSON.stringify({ attachments: [{ id: 0, filename: 'profile.png' }] }));
    const blob: any = new (globalThis as any).Blob([buffer], { type: 'image/png' });
    form.append('files[0]', blob, 'profile.png');

    await fetch(`https://discord.com/api/v10/webhooks/${appId}/${token}`, {
      method: 'POST',
      headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
      body: form as any,
    });
  } catch (err) {
    console.error('[profile-hook] Failed to send image', err);
  }

  res.json({ status: 'queued' });
});

// ---- Presence listener to push fun facts on song change ----
client.on('presenceUpdate', async (oldPresence, newPresence) => {
  const userId = newPresence.userId;
  const session = sessions.get(userId);
  if (!session) return; // not actively listening

  const spotifyAct = newPresence.activities.find(
    (a) => a.type === ActivityType.Listening && a.name === 'Spotify',
  );

  if (!spotifyAct) return; // user stopped listening; keep session until track change or manual stop

  const trackIdentifier = (spotifyAct as any).syncId ?? spotifyAct.details ?? '';
  if (!trackIdentifier || trackIdentifier === session.lastTrackId) return; // same song

  // New song detected
  const artistTextRaw = spotifyAct.state || spotifyAct.assets?.largeText?.split(' – ')[0] || '';
  const artistText = artistTextRaw.split(/[;,]/)[0].trim() || 'Unknown artist';

  // Update session state
  session.lastTrackId = trackIdentifier;
  session.factCount += 1;

  const fact = await getFunFact(artistText);

  try {
    await rest.post(Routes.channelMessages(session.channelId), {
      body: {
        content: `🎶 ${fact}`,
        tts: true,
      },
    });
  } catch (err) {
    console.error('Failed to post fun fact', err);
  }

  if (session.factCount >= 3) {
    sessions.delete(userId);
  }
});

// ---- Message listener for #bot-chat ----
client.on('messageCreate', async (message: Message) => {
  // Ignore messages sent by *this* bot to prevent feedback loops.
  if (message.author.id === client.user?.id) return;

  // -----------------------------
  // Music bot "now playing" flow
  // -----------------------------
  const musicSession = musicSessions.get(message.channel.id);
  if (musicSession && message.author.id === musicSession.botId) {
    const npMatch = /now\s*playing[:]?\s*(.+)/i.exec(message.content);
    if (npMatch && npMatch[1]) {
      const nowPlayingLine = npMatch[1].trim();
      const fact = await getSongFunFact(nowPlayingLine);

      // Reset inactivity timer
      scheduleMusicTimeout(message.channel.id);

      // Try to send to voice channel if bot is connected
      let destinationChannel: any = message.channel;
      if (message.guild) {
        try {
          const botMember = await message.guild.members.fetch(message.author.id);
          const voiceChan = botMember.voice?.channel;
          if (voiceChan && (voiceChan as any).send) {
            destinationChannel = voiceChan as any;
          }
        } catch (err) {
          console.error('Failed to resolve bot voice channel', err);
        }
      }

      try {
        await destinationChannel.send({ content: `🎶 ${fact}`, tts: true });
      } catch (err) {
        console.error('Failed to send song fact', err);
      }
    }
    return; // Do not run chat answer flow
  }

  // ------------------------------------
  // Chat Q&A flow for channels in chatChannels
  // ------------------------------------
  if (!chatChannels.has(message.channel.id)) return;

  if (message.author.bot) return; // ignore other bots in chat Q&A

  // Attempt to include current Spotify song context if author is listening
  let songCtx: SongContext | undefined;
  const activities = message.member?.presence?.activities || [];
  const spotifyAct = activities.find((a) => a.type === ActivityType.Listening && a.name === 'Spotify');
  if (spotifyAct) {
    const track = spotifyAct.details || '';
    let artist = spotifyAct.state || '';
    if (!artist) {
      const largeText = spotifyAct.assets?.largeText as string | undefined;
      if (largeText && largeText.includes(' – ')) {
        artist = largeText.split(' – ')[0];
      }
    }
    if (track && artist) {
      songCtx = { track, artist };
    }
  }

  const answer = await getChatAnswer(message.content, songCtx);

  // Reset inactivity timer
  scheduleChatTimeout(message.channel.id);

  try {
    if (message.channel.isTextBased()) {
      await (message.channel as any).send({ content: answer });
    }
  } catch (err) {
    console.error('Failed to send chat answer', err);
  }
});

app.get('/', (_, res) => {
  res.send('Listen Receiver up');
});

app.listen(parseInt(PORT, 10), () => {
  console.log(`Listen receiver running on port ${PORT}`);
}); 