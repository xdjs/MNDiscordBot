import { REST, Routes } from 'discord.js';

export interface ListenSession {
  channelId: string;
  guildId: string;
  /** Last Spotify track identifier responded to. */
  lastTrackId: string | null;
  factCount: number;
  /** Timer that ends the session after inactivity */
  timeout?: NodeJS.Timeout;
}

export const sessions = new Map<string, ListenSession>();

export function scheduleListenTimeout(userId: string, rest: REST) {
  const session = sessions.get(userId);
  if (!session) return;
  if (session.timeout) clearTimeout(session.timeout);
  const timeout = setTimeout(async () => {
    sessions.delete(userId);
    try {
      await rest.post(Routes.channelMessages(session.channelId), {
        body: { content: '⌛ Listening session closed due to inactivity.' },
      });
    } catch (err) {
      console.error('Failed to post listen timeout message', err);
    }
    console.log(`Listen session for user ${userId} closed due to inactivity.`);
  }, 10 * 60 * 1000);
  session.timeout = timeout;
}
