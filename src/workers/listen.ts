import { Client, GatewayIntentBits, ActivityType, REST, Routes } from 'discord.js';
import { sessions, scheduleListenTimeout } from '../sessions/listen.js';
import { getFunFact } from '../utils/openai.js';
// Register Discord presence listener to handle track changes
import { registerPresenceListener } from '../listeners/presenceUpdate.js';

export interface ListenJobPayload {
  user_id: string;
  channel_id: string;
  guild_id: string;
}

// Singleton Discord client shared by this worker module
let client: Client | undefined;
let rest: REST | undefined;
// Ensure we only attach the presence listener once
let presenceListenerRegistered = false;

function ensureClient(): Promise<void> {
  if (client && client.isReady()) return Promise.resolve();

  return new Promise((resolve) => {
    const token = process.env.DISCORD_BOT_TOKEN as string;

    if (!client) {
      client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMembers,
          GatewayIntentBits.GuildPresences,
        ],
      });
      client.login(token).catch((err) => console.error('[listen-worker] login failed', err));
    }

    if (!rest) {
      rest = new REST({ version: '10' }).setToken(token);
    }

    // Attach presence listener once the REST client is available
    if (!presenceListenerRegistered && client && rest) {
      registerPresenceListener(client, rest);
      presenceListenerRegistered = true;
    }

    if (client.isReady()) resolve();
    else client.once('ready', () => resolve());
  });
}

export async function runListenJob(payload: ListenJobPayload) {
  await ensureClient();
  if (!client || !rest) throw new Error('Discord client not ready');

  const { user_id: userId, channel_id: channelId, guild_id: guildId } = payload;

  try {
    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId);
    const hasSpotify = member.presence?.activities.some(
      (a) => a.type === ActivityType.Listening && a.name === 'Spotify',
    );

    if (!hasSpotify) {
      await rest.post(Routes.channelMessages(channelId), {
        body: {
          content:
            `<@${userId}>, please enable "Display current activity as a status message" and play a song so I can detect your Spotify activity.`,
        },
      });
      return;
    }

    const spotifyAct = member.presence?.activities.find(
      (a) => a.type === ActivityType.Listening && a.name === 'Spotify',
    );

    let artistText =
      spotifyAct?.state ||
      spotifyAct?.assets?.largeText?.split(' – ')[0] ||
      spotifyAct?.details;

    if (artistText) {
      artistText = artistText
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .join(', ');
    }
    if (!artistText) artistText = 'Unknown artist';
    const trackTitle = spotifyAct?.details || undefined;
    const fact = await getFunFact(artistText as string, trackTitle);

    await rest.post(Routes.channelMessages(channelId), { body: { content: `🎶 ${fact}` } });

    sessions.set(userId, {
      channelId,
      guildId,
      lastTrackId: (spotifyAct as any)?.syncId ?? spotifyAct?.details ?? null,
      factCount: 1,
      timeout: undefined,
    });

    scheduleListenTimeout(userId, rest);
  } catch (err) {
    console.error('[listen-worker] error', err);
  }
} 