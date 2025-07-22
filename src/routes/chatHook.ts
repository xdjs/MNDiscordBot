import { Express } from 'express';
import { Client } from 'discord.js';
import { chatChannels, scheduleChatTimeout } from '../sessions/chat.js';

/**
 * Registers POST /chat-hook endpoint on the provided Express app.
 * Activates Q&A chat mode for the given channel and schedules timeout.
 */
export function registerChatHook(app: Express, client: Client) {
  app.post('/chat-hook', (req, res) => {
    const { channel_id: channelId } = req.body as { channel_id?: string };
    if (!channelId) return res.status(400).json({ error: 'Missing channel_id' });

    chatChannels.add(channelId);
    console.log('Chat listening activated for', channelId);
    scheduleChatTimeout(channelId, client);
    return res.json({ status: 'ok' });
  });
} 