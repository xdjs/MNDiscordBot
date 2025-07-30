import { musicSessions, scheduleMusicTimeout } from '../../src/sessions/music.js';
import { jest } from '@jest/globals';

describe('music session timeout helper', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    musicSessions.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('clears music session after 2 minutes', () => {
    // pre-create session
    musicSessions.set('chan1', {
      botId: 'bot123',
      factCount: 1,
      timeout: setTimeout(() => {}, 0),
    });

    scheduleMusicTimeout('chan1');
    expect(musicSessions.get('chan1')!.timeout).toBeDefined();

    jest.advanceTimersByTime(2 * 60 * 1000);

    expect(musicSessions.has('chan1')).toBe(false);
  });
});
