import { Express } from 'express';
import { REST, Routes, ActivityType, Client as DiscordClient } from 'discord.js';
import { sessions, scheduleListenTimeout } from '../sessions/listen.js';
import { getFunFact } from '../utils/openai.js';

interface ListenHookBody {
  user_id?: string;
  channel_id?: string;
  guild_id?: string;
}

/**
 * Registers POST /listen-hook endpoint. Returns JSON status.
 */
export function registerListenHook(app: Express, client: DiscordClient, rest: REST) {
  async function ensureReady() {
    if (client.readyTimestamp) return;
    await new Promise((res) => client.once('ready', res));
  }

  app.post('/listen-hook', async (req, res) => {
    const { user_id: userId, channel_id: channelId, guild_id: guildId } = req.body as ListenHookBody;

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

      //checks for the spotify activity in users status
      if (!hasSpotify) {
        await rest.post(Routes.channelMessages(channelId), {
          body: {
            content:
              `<@${userId}>, please enable "Display current activity as a status message" in your Discord settings so I can detect your Spotify activity. If you do have it enabled then please play a song and try again.`,
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
        spotifyAct?.assets?.largeText?.split(' – ')[0] ||
        spotifyAct?.details;

      console.log('artistText extracted:', artistText);
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

      await rest.post(Routes.channelMessages(channelId), {
        body: { content: `🎶 ${fact}` },
      });

      // Start active session tracking
      sessions.set(userId, {
        channelId,
        guildId,
        lastTrackId: (spotifyAct as any)?.syncId ?? spotifyAct?.details ?? null,
        factCount: 1,
        timeout: undefined,
      });

      // Start inactivity timer
      scheduleListenTimeout(userId, rest);  //defined in sessions/listen.ts

      res.json({ status: 'ok' });
    } catch (err) {
      console.error('Failed to process listen hook', err);
      res.status(500).json({ error: 'Server error' });
    }
  });
} 