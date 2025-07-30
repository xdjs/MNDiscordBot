// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('discord.js', () => ({ REST: jest.fn(), Routes: { channelMessages: (id) => id } }));

import { sessions, scheduleListenTimeout } from '../../src/sessions/listen.js';

describe('listen session timeout helper', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    sessions.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.resetAllMocks();
  });

  it('posts timeout message and deletes session after 10 minutes', async () => {
    const postMock = jest.fn();
    const restStub = { post: postMock } as any;

    sessions.set('user1', {
      channelId: 'chan1',
      guildId: 'g1',
      lastTrackId: null,
      factCount: 0,
    });

    scheduleListenTimeout('user1', restStub);
    jest.advanceTimersByTime(10 * 60 * 1000);
    await Promise.resolve();

    expect(postMock).toHaveBeenCalled();
    expect(sessions.has('user1')).toBe(false);
  });
});
