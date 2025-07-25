import { Client, ActivityType, REST, Routes } from 'discord.js';
import { sessions, scheduleListenTimeout } from '../sessions/listen.js';
import { getFunFact } from '../utils/openai.js';

export function registerPresenceListener(client: Client, rest: REST) {
  client.on('presenceUpdate', async (_oldPresence, newPresence) => {
    const userId = newPresence.userId;
    const session = sessions.get(userId);
    if (!session) return;

    const spotifyAct = newPresence.activities.find(
      (a) => a.type === ActivityType.Listening && a.name === 'Spotify',
    );

    // Reset inactivity timer if still listening
    if (spotifyAct) scheduleListenTimeout(userId, rest);

    if (!spotifyAct) return;

    const trackIdentifier = (spotifyAct as any).syncId ?? spotifyAct.details ?? '';
    if (!trackIdentifier || trackIdentifier === session.lastTrackId) return;

    // New song
    const artistRaw = spotifyAct.state || spotifyAct.assets?.largeText?.split(' – ')[0] || '';
    console.log('[presence] raw artist extracted:', artistRaw, 'user', userId);
    const artistText =
      artistRaw
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .join(', ') || 'Unknown artist';
    console.log('[presence] artistText normalized:', artistText, 'user', userId);

    session.lastTrackId = trackIdentifier;
    session.factCount += 1;

    const trackTitle = spotifyAct.details || undefined;
    const fact = await getFunFact(artistText, trackTitle);

    try {
      await rest.post(Routes.channelMessages(session.channelId), { body: { content: `🎶 ${fact}` } });

      // Reset inactivity timer **after** successfully sending a fun fact as well.
      // This provides an extra safety net in case presenceUpdate frequency is sparse
      // (e.g. very long tracks or rare presence refreshes).
      scheduleListenTimeout(userId, rest);
    } catch (err) {
      console.error('Failed to post fun fact', err);
    }

    if (session.factCount >= 10) {
      if (session.timeout) clearTimeout(session.timeout);
      sessions.delete(userId);
    }
  });
} 