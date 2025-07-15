import 'dotenv/config';
import express from 'express';
import { REST, Routes } from 'discord.js';
import {
  Client as DiscordClient,
  GatewayIntentBits,
  ActivityType,
} from 'discord.js';

// ---- OpenAI helper ----
const { OPENAI_API_KEY } = process.env;

async function getFunFact(artist: string): Promise<string> {
  if (!OPENAI_API_KEY) return `${artist} is cool!`;

  const prompt = `Give me one very short fun fact about the musical artist ${artist} (about 50 words). 
                    If you can not find anything about the artist, 
                    do not make stuff up just respond with: 
                    I'm sorry but I couldnt find anything about this artist.`;

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

    let artistText = spotifyAct?.state ?? '';
    if (artistText) {
      artistText = artistText.split(/[;,]/)[0].trim();
    }
    if (!artistText) artistText = 'Unknown artist';
    const fact = await getFunFact(artistText);

    await rest.post(Routes.channelMessages(channelId), {
      body: {
        content: `🎶 ${fact}`,

      },
    });

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Failed to process listen hook', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/', (_, res) => {
  res.send('Listen Receiver up');
});

app.listen(parseInt(PORT, 10), () => {
  console.log(`Listen receiver running on port ${PORT}`);
}); 