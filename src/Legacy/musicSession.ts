export interface MusicSession {
  botId: string;
  timeout: NodeJS.Timeout;
  factCount: number;
}

export const musicSessions = new Map<string, MusicSession>();

export function scheduleMusicTimeout(channelId: string) {
  const session = musicSessions.get(channelId);
  if (!session) return;
  clearTimeout(session.timeout);
  const timeout = setTimeout(() => {
    musicSessions.delete(channelId);
    console.log(`Music session for ${channelId} closed due to inactivity.`);
  }, 7 * 60 * 1000);
  session.timeout = timeout;
}
