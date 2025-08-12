import { getVoiceConnection } from '@discordjs/voice';

const idleTimers = new Map<string, NodeJS.Timeout>();
const DEFAULT_IDLE_MS = 10 * 60 * 1000; // 10 minutes

export function scheduleIdleDisconnect(guildId: string, ms: number = DEFAULT_IDLE_MS): void {
  clearIdleDisconnect(guildId);
  const timeout = setTimeout(() => {
    try {
      const conn = getVoiceConnection(guildId);
      if (conn) conn.destroy();
    } catch {
      // ignore
    } finally {
      idleTimers.delete(guildId);
    }
  }, ms);
  idleTimers.set(guildId, timeout);
}

export function clearIdleDisconnect(guildId: string): void {
  const t = idleTimers.get(guildId);
  if (t) {
    clearTimeout(t);
    idleTimers.delete(guildId);
  }
}

