import { Express } from 'express';
import { musicSessions, scheduleMusicTimeout } from '../sessions/music.js';

/**
 * Registers POST /music-hook endpoint on the provided Express app.
 * Tracks "now playing" messages coming from a specific music bot in the given channel.
 * For /listen start @<music bot>
 */
export function registerMusicHook(app: Express) {
  app.post('/music-hook', (req, res) => {
    const { channel_id: channelId, bot_id: botId } = req.body as {
      channel_id?: string;
      bot_id?: string;
    };
    if (!channelId || !botId) return res.status(400).json({ error: 'Missing channel_id or bot_id' });

    // Clear existing timer if any and set new session
    const existing = musicSessions.get(channelId);
    if (existing) clearTimeout(existing.timeout);

    // Create fresh session and schedule inactivity timeout
    const timeout = setTimeout(() => {}, 0); // placeholder
    musicSessions.set(channelId, { botId, timeout, factCount: 0 });
    scheduleMusicTimeout(channelId);

    console.log('Music listening activated for', channelId, 'bot', botId);
    return res.json({ status: 'ok' });
  });
} 