jest.useFakeTimers();

let lastDestroyedGuild: string | null = null;

jest.mock('@discordjs/voice', () => ({
  getVoiceConnection: jest.fn((guildId: string) => ({ destroy: () => { lastDestroyedGuild = guildId; } })),
}));

import { scheduleIdleDisconnect, clearIdleDisconnect } from '../../src/utils/voiceIdle.js';

describe('voice idle disconnect', () => {
  beforeEach(() => { lastDestroyedGuild = null; });

  it('schedules and triggers disconnect after 10 minutes', () => {
    scheduleIdleDisconnect('g1');
    jest.advanceTimersByTime(10 * 60 * 1000);
    expect(lastDestroyedGuild).toBe('g1');
  });

  it('can be cleared before firing', () => {
    scheduleIdleDisconnect('g2');
    clearIdleDisconnect('g2');
    jest.advanceTimersByTime(10 * 60 * 1000);
    expect(lastDestroyedGuild).toBeNull();
  });
});

