import { InteractionResponseType } from 'discord-interactions';

jest.mock('../../src/utils/voiceIdle.js', () => ({
  scheduleIdleDisconnect: jest.fn(),
  clearIdleDisconnect: jest.fn(),
}));

// Minimal mocks for discord.js and @discordjs/voice
let mockMember: any = {};
let mockGuild: any = {};

jest.mock('discord.js', () => {
  mockMember = { voice: { channel: { id: 'vc1', name: 'General' } } };
  mockGuild = {
    id: 'g1',
    voiceAdapterCreator: {} as any,
    members: { fetch: jest.fn(async () => mockMember) },
  };
  const clientMock: any = {
    isReady: () => true,
    login: jest.fn(),
    once: jest.fn(),
    guilds: { fetch: jest.fn(async () => mockGuild) },
  };
  return {
    Client: jest.fn(() => clientMock),
    GatewayIntentBits: { Guilds: 1, GuildMembers: 2, GuildPresences: 4, GuildVoiceStates: 8 },
    ChannelType: { GuildVoice: 2, GuildStageVoice: 13 },
  };
});

let conn: any;

jest.mock('@discordjs/voice', () => {
  const mod: any = {
    joinVoiceChannel: jest.fn(() => conn),
    getVoiceConnection: jest.fn(() => undefined),
    VoiceConnectionStatus: { Ready: 'ready' },
    entersState: jest.fn(async () => undefined),
  };
  return mod;
});

import { connect } from '../../api/commands/connect.js';

describe('/connect command', () => {
  beforeEach(() => {
    conn = { destroy: jest.fn() };
  });

  it('prompts user to join VC if not in one', async () => {
    mockMember.voice.channel = null;
    const res = await connect({ guild_id: 'g1', member: { user: { id: 'u1' } } });
    expect(res.type).toBe(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
    expect(res.data.flags).toBe(64);
    expect(res.data.content).toMatch(/Join a voice channel/);
  });

  it('connects to user VC and acknowledges', async () => {
    mockMember.voice.channel = { id: 'vc1', name: 'General', type: 2 };
    const res = await connect({ guild_id: 'g1', member: { user: { id: 'u1' } } });
    expect(res.type).toBe(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
    expect(res.data.flags).toBe(64);
    expect(res.data.content).toContain('Connected to');
  });
});

