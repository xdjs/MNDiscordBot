import { Express } from 'express';
import { sessions } from '../sessions/listen.js';
import { REST, Routes } from 'discord.js';

interface StopHookBody {
  user_id?: string;
  channel_id?: string;
  application_id?: string;
  interaction_token?: string;
}

export function registerListenStopHook(app: Express, rest: REST) {
  app.post('/listen-stop', async (req, res) => {
    const { user_id: userId, channel_id: channelId } = req.body as StopHookBody;

    const secret = process.env.LISTEN_STOP_HOOK_SECRET;
    if (secret && req.get('x-listen-signature') !== secret) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    if (!userId || !channelId) {
      return res.status(400).json({ error: 'Missing user_id or channel_id' });
    }

    const session = sessions.get(userId);
    if (session?.timeout) clearTimeout(session.timeout);
    sessions.delete(userId);

    try {
      await rest.post(Routes.channelMessages(channelId), {
        body: { content: '🛑 Listening session ended by user.' },
      });
    } catch (err) {
      console.error('[listen-stop] failed to notify channel', err);
    }

    res.json({ status: 'stopped' });
  });
} 