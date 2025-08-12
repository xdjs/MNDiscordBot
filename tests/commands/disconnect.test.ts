import { InteractionResponseType } from 'discord-interactions';

jest.mock('../../src/utils/voiceIdle.js', () => ({ clearIdleDisconnect: jest.fn() }));

let conn: any = undefined;

jest.mock('discord.js', () => {
  const guildObj = { id: 'g1', members: { fetch: jest.fn(async () => ({})) } } as any;
  const clientMock: any = {
    isReady: () => true,
    login: jest.fn(),
    once: jest.fn(),
    guilds: { fetch: jest.fn(async () => guildObj) },
  };
  return {
    Client: jest.fn(() => clientMock),
    GatewayIntentBits: { Guilds: 1, GuildMembers: 2, GuildPresences: 4, GuildVoiceStates: 8 },
  };
});

jest.mock('@discordjs/voice', () => ({
  getVoiceConnection: jest.fn(() => conn),
}));

import { disconnect } from '../../api/commands/disconnect.js';

describe('/disconnect command', () => {
  it('tells when not connected', async () => {
    conn = undefined;
    const res = await disconnect({ guild_id: 'g1' } as any);
    expect(res.type).toBe(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
    expect(res.data.content).toMatch(/not connected/);
  });

  it('disconnects when connected', async () => {
    conn = { destroy: jest.fn() };
    const res = await disconnect({ guild_id: 'g1' } as any);
    expect(conn.destroy).toHaveBeenCalled();
    expect(res.data.content).toMatch(/Disconnected/);
  });
});

