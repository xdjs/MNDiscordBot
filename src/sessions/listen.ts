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

/**
 * Map of userId -> ListenSession.
 * Exported so other modules can read / write directly if needed.
 */
export const sessions = new Map<string, ListenSession>();

/**
 * Resets the inactivity timer for a given user and schedules session cleanup.
 * Must be called whenever the user changes track or the webhook is invoked.
 */
export function scheduleListenTimeout(userId: string, rest: REST) {
  const session = sessions.get(userId);
  if (!session) return;

  // Clear any existing timer
  if (session.timeout) clearTimeout(session.timeout);

  const timeout = setTimeout(async () => {
    // Remove session record
    sessions.delete(userId);

    // Notify channel that the session closed
    try {
      await rest.post(Routes.channelMessages(session.channelId), {
        body: { content: '⌛ Listening session closed due to inactivity.' },
      });
    } catch (err) {
      console.error('Failed to post listen timeout message', err);
    }

    console.log(`Listen session for user ${userId} closed due to inactivity.`);
  }, 10 * 60 * 1000); // 10 minutes

  session.timeout = timeout;
} 