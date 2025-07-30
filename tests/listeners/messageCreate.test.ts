// @ts-nocheck
import { EventEmitter } from 'events';

const restPostMock = jest.fn();

jest.mock('discord.js', () => {
  const EventEmitter = require('events');
  return {
    Client: class extends EventEmitter {
      constructor() { super(); this.user = { id: 'botUser' }; }
    },
    REST: jest.fn().mockImplementation(() => ({ post: restPostMock })),
    Routes: { channelMessages: (id) => `/channels/${id}/messages` },
  };
});

jest.mock('../../src/utils/openai.js', () => ({
  getSongFunFact: jest.fn().mockResolvedValue('Fact!'),
  getChatAnswer: jest.fn().mockResolvedValue('Answer!'),
}));

const musicSessionsMap = new Map<string, any>();
const chatChannelsSet = new Set<string>();
const scheduleMusicTimeoutMock = jest.fn();
const scheduleChatTimeoutMock = jest.fn();

jest.mock('../../src/sessions/music.js', () => ({
  musicSessions: musicSessionsMap,
  scheduleMusicTimeout: scheduleMusicTimeoutMock,
}));

jest.mock('../../src/sessions/chat.js', () => ({
  chatChannels: chatChannelsSet,
  scheduleChatTimeout: scheduleChatTimeoutMock,
}));

import { registerMessageListener } from '../../src/listeners/messageCreate.js';
import { Client, REST } from 'discord.js';

describe('messageCreate listener', () => {
  const client = new Client();
  const rest = new REST();
  registerMessageListener(client as any, rest as any);

  beforeEach(() => {
    restPostMock.mockClear();
    scheduleChatTimeoutMock.mockClear();
    scheduleMusicTimeoutMock.mockClear();
    (musicSessionsMap as any).clear();
    chatChannelsSet.clear();
  });

  it('handles chat Q&A flow', async () => {
    chatChannelsSet.add('chan1');
    const msg = {
      author: { id: 'user1', bot: false },
      content: 'Hello?',
      channel: { id: 'chan1', isTextBased: () => true, send: jest.fn() },
      member: { presence: { activities: [] } },
    } as any;

    await client.emit('messageCreate', msg);
    expect(scheduleChatTimeoutMock).toHaveBeenCalled();
    expect(msg.channel.send).toHaveBeenCalledWith({ content: 'Answer!' });
  });

  it('handles music bot flow', async () => {
    musicSessionsMap.set('chan1', { botId: 'musicBot', factCount: 0 });
    const msg = {
      author: { id: 'musicBot' },
      content: 'Now Playing: Something',
      channel: { id: 'chan1' },
    } as any;

    await client.emit('messageCreate', msg);
    expect(scheduleMusicTimeoutMock).toHaveBeenCalled();
    expect(restPostMock).toHaveBeenCalledWith('/channels/chan1/messages', { body: { content: '🎶 Fact!' } });
  });
});
