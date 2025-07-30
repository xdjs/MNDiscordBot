// @ts-nocheck
import { chatChannels, chatSessions, scheduleChatTimeout } from '../../src/sessions/chat.js';
import { jest } from '@jest/globals';

describe('chat session timeout helper', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    chatChannels.clear();
    chatSessions.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.resetAllMocks();
  });

  it('adds channel and sends timeout message after 2 minutes', async () => {
    const sendMock = jest.fn();
    const clientStub = {
      channels: {
        fetch: jest.fn().mockResolvedValue({
          isTextBased: () => true,
          send: sendMock,
        } as any),
      },
    } as any;

    chatChannels.add('channel1');

    scheduleChatTimeout('channel1', clientStub);
    expect(chatSessions.has('channel1')).toBe(true);

    jest.advanceTimersByTime(2 * 60 * 1000);
    await Promise.resolve();

    expect(chatChannels.has('channel1')).toBe(false);
    expect(chatSessions.has('channel1')).toBe(false);
    expect(sendMock).toHaveBeenCalledWith('⌛ Chat session closed due to inactivity.');
  });
});
