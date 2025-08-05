import { InteractionResponseType } from 'discord-interactions';

// ---------------- Mock discord.js ------------------
let mockActivities: any[] = [];

jest.mock('discord.js', () => {
  const guildObj = {
    members: {
      // overwritten below per-test
      fetch: jest.fn(async () => ({ presence: { activities: mockActivities } })),
    },
  };
  const clientMock: any = {
    isReady: () => true,
    login: jest.fn(),
    once: jest.fn(),
    guilds: {
      fetch: jest.fn(async () => guildObj),
    },
  };
  return {
    // minimal surface required by the command handler
    Client: jest.fn(() => clientMock),
    GatewayIntentBits: { Guilds: 1, GuildMembers: 2, GuildPresences: 4 },
    ActivityType: { Listening: 'LISTENING' },
  };
});

import { eavesdrop } from '../../api/commands/eavesdrop.js';

describe('eavesdrop command', () => {
  const baseInteraction = {
    guild_id: 'g1',
    data: { options: [{ name: 'user', value: 'u1' }] },
  } as any;

  afterEach(() => {
    mockActivities = [];
  });

  it('returns current track when user is listening', async () => {
    mockActivities = [
      {
        type: 'LISTENING',
        name: 'Spotify',
        details: 'Song A',
        state: 'Artist A',
      },
    ];

    const res = await eavesdrop(baseInteraction);
    expect(res.type).toBe(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
    expect(res.data.flags).toBe(64);
    expect(res.data.content).toContain('<@u1> is listening to');
    expect(res.data.content).toContain('Song A');
    expect(res.data.content).toContain('Artist A');
  });

  it('handles absence of Spotify activity', async () => {
    const res = await eavesdrop(baseInteraction);
    expect(res.type).toBe(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
    expect(res.data.flags).toBe(64);
    expect(res.data.content).toContain("I can't detect");
  });
});
