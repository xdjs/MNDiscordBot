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
}));

const musicSessionsMap = new Map<string, any>();
const scheduleMusicTimeoutMock = jest.fn();

jest.mock('../../src/sessions/music.js', () => ({
  musicSessions: musicSessionsMap,
  scheduleMusicTimeout: scheduleMusicTimeoutMock,
}));


import { registerMessageListener } from '../../src/listeners/messageCreate.js';
import { Client, REST } from 'discord.js';

describe('messageCreate listener', () => {
  const client = new Client();
  const rest = new REST();
  registerMessageListener(client as any, rest as any);

  beforeEach(() => {
    restPostMock.mockClear();
    scheduleMusicTimeoutMock.mockClear();
    (musicSessionsMap as any).clear();
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
