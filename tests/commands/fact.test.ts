import { InteractionResponseType } from 'discord-interactions';

jest.mock('../../src/utils/openai.js', () => ({ getFunFact: jest.fn(async () => 'A neat fact.') }));
jest.mock('../../src/utils/voiceIdle.js', () => ({
  scheduleIdleDisconnect: jest.fn(),
  clearIdleDisconnect: jest.fn(),
}));
jest.mock('../../api/lib/supabase.js', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        limit: jest.fn(() => ({
          single: jest.fn(async () => ({ data: { fun_fact: '{artist} cool' } })),
        })),
      })),
    })),
  },
}));

let mockMember: any = {};
let mockGuild: any = {};

jest.mock('discord.js', () => {
  mockMember = { presence: { activities: [] }, voice: { channel: { id: 'vc1', name: 'General', type: 2 } } };
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
    ActivityType: { Listening: 'LISTENING' },
    ChannelType: { GuildVoice: 2, GuildStageVoice: 13 },
  };
});

let conn: any;
let player: any;

jest.mock('@discordjs/voice', () => {
  player = { play: jest.fn(), once: jest.fn(), on: jest.fn() };
  conn = { subscribe: jest.fn(), destroy: jest.fn() };
  const mod: any = {
    joinVoiceChannel: jest.fn(() => conn),
    getVoiceConnection: jest.fn(() => undefined),
    VoiceConnectionStatus: { Ready: 'ready' },
    entersState: jest.fn(async () => undefined),
    createAudioPlayer: jest.fn(() => player),
    NoSubscriberBehavior: { Play: 'play' },
    AudioPlayerStatus: { Idle: 'idle' },
    createAudioResource: jest.fn(() => ({})),
    StreamType: { Raw: 'raw' },
  };
  return mod;
});

jest.mock('prism-media', () => {
  const { Transform } = require('stream');
  class Dummy extends Transform {
    _transform(chunk: any, _enc: any, cb: any) { this.push(chunk); cb(); }
  }
  return { FFmpeg: jest.fn(() => new Dummy()) };
});

// TTS web stream mock
jest.mock('../../src/utils/tts.js', () => ({
  synthesizeSpeech: jest.fn(async () => new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1,2,3]));
      controller.close();
    },
  })),
}));

import { fact } from '../../api/commands/fact.js';

describe('/fact command', () => {
  const interaction = { guild_id: 'g1', member: { user: { id: 'u1' } } } as any;

  it('asks user to join VC if not in one', async () => {
    mockMember.voice.channel = null;
    const res = await fact(interaction);
    expect(res.data.flags).toBe(64);
    expect(res.data.content).toMatch(/Join a voice channel/);
  });

  it('returns error if no Spotify activity', async () => {
    mockMember.voice.channel = { id: 'vc1', name: 'General', type: 2 };
    mockMember.presence.activities = [];
    const res = await fact(interaction);
    expect(res.data.flags).toBe(64);
    expect(res.data.content).toMatch(/cannot detect/);
  });

  it('plays a fact when listening', async () => {
    mockMember.voice.channel = { id: 'vc1', name: 'General', type: 2 };
    mockMember.presence.activities = [{ type: 'LISTENING', name: 'Spotify', details: 'Song', state: 'Artist' }];
    const res = await fact(interaction);
    expect(res.data.flags).toBe(64);
    expect(res.data.content).toContain('🎶');
  });
});

