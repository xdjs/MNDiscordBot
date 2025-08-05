import { InteractionResponseType } from 'discord-interactions';

jest.mock('../../src/utils/openai.js', () => ({ getFunFact: jest.fn(async () => 'Fun fact!') }));

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({ select: () => ({ limit: () => ({ single: () => ({ data: { fun_fact: '{artist} cool' } }) }) }) }) }),
}));

let mockActivities: any[] = [];

jest.mock('discord.js', () => {
  const guildObj = {
    members: {
      fetch: jest.fn(async () => ({ presence: { activities: mockActivities } })),
    },
  };
  const clientMock: any = {
    isReady: () => true,
    login: jest.fn(),
    once: jest.fn(),
    guilds: { fetch: jest.fn(async () => guildObj) },
  };
  return {
    Client: jest.fn(() => clientMock),
    GatewayIntentBits: { Guilds: 1, GuildMembers: 2, GuildPresences: 4 },
    ActivityType: { Listening: 'LISTENING' },
  };
});

import { nerdout } from '../../api/commands/nerdout.js';

describe('nerdout command', () => {
  const baseInteraction: any = {
    guild_id: 'g1',
    member: { user: { id: 'u1' } },
  };

  afterEach(() => {
    mockActivities = [];
  });

  it('returns fun fact when listening', async () => {
    mockActivities = [{ type: 'LISTENING', name: 'Spotify', details: 'Song X', state: 'Artist Y' }];
    const res = await nerdout(baseInteraction);
    expect(res.type).toBe(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
    expect(res.data.flags).toBe(64);
    expect(res.data.content).toContain('Fun fact');
  });

  it('handles missing presence', async () => {
    const res = await nerdout(baseInteraction);
    expect(res.data.flags).toBe(64);
    expect(res.data.content).toContain('cannot detect');
  });
});
