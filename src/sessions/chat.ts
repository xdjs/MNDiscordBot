import { Client } from 'discord.js';

export interface ChatSession {
  timeout: NodeJS.Timeout;
}

export const chatChannels = new Set<string>();
export const chatSessions = new Map<string, ChatSession>(); // key = channelId

/**
 * Resets inactivity timer for a chat-enabled channel.
 * When the timer elapses the channel is removed from chat mode and a timeout
 * notice is posted.
 */
export function scheduleChatTimeout(channelId: string, client: Client) {
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