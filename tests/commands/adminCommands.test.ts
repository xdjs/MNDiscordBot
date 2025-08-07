// @ts-nocheck

import { InteractionResponseType } from 'discord-interactions';

// -------------- Global fetch mock -------------------
const fetchMock = jest.fn();

global.fetch = fetchMock as any;

// Ensure bot token env for help.ts
process.env.DISCORD_BOT_TOKEN = 'TEST_TOKEN';

// -------------- Supabase mock helpers ---------------
const fromMock = jest.fn();
const upsertMock = jest.fn().mockResolvedValue({});
const selectMock = jest.fn().mockReturnThis();
const eqMock = jest.fn().mockReturnThis();
const maybeSingleMock = jest.fn().mockResolvedValue({ data: null });

fromMock.mockReturnValue({
  upsert: upsertMock,
  select: selectMock,
  eq: eqMock,
  maybeSingle: maybeSingleMock,
});

jest.mock('../../api/lib/supabase.js', () => ({
  supabase: { from: fromMock },
}));

// -------------- wrap session mocks ------------------
const isWrappedMock = jest.fn();
const startWrapMock = jest.fn();
const stopWrapMock = jest.fn();

jest.mock('../../src/sessions/wrap.js', () => ({
  isWrapped: (id:string)=> isWrappedMock(id),
  startWrap: (id:string)=> startWrapMock(id),
  stopWrap: (id:string)=> stopWrapMock(id),
}));

// -------------- Imports under test ------------------
import { help } from '../../api/commands/help.js';
import { settime } from '../../api/commands/settime.js';
import { wrap as wrapCmd } from '../../api/commands/wrap.js';
import { unwrap as unwrapCmd } from '../../api/commands/unwrap.js';
import { update as updateCmd } from '../../api/commands/update.js';

// -------------- Test fixtures -----------------------
function baseInteraction(overrides: Partial<any> = {}) {
  return {
    guild_id: 'guild1',
    member: {
      permissions: '0', // default no perms
      user: { id: 'user1' },
    },
    data: {},
    ...overrides,
  } as any;
}

function adminPermInteraction(overrides: Partial<any> = {}) {
  return baseInteraction({ member: { permissions: '8', user: { id: 'admin' } }, ...overrides });
}

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'dm1' }) });
});

// -------------------- help ---------------------------
describe('help command', () => {
  it('sends DM and returns confirmation', async () => {
    const res = await help('user1');
    expect(fetchMock).toHaveBeenCalledTimes(2); // create DM + send message
    expect(res.type).toBe(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
    expect(res.data.content).toContain('sent you a DM');
  });

  it('fallbacks when DM cannot be opened', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });
    const res = await help('user2');
    expect(res.data.content).toMatch(/check your privacy settings/i);
  });
});

// ------------------- settime -------------------------
describe('settime command', () => {
  it('rejects non-admin users', async () => {
    const res = await settime(baseInteraction({ data: { options: [{ value: '12:00' }] } }));
    expect(res.data.content).toMatch(/only server administrators/i);
  });

  it('rejects invalid time format', async () => {
    const res = await settime(adminPermInteraction());
    expect(res.data.content).toMatch(/valid local time/i);
  });

  it('accepts valid time from admin', async () => {
    const res = await settime(adminPermInteraction({ data: { options: [{ value: '14:30' }] } } as any));
    expect(res.data.content).toMatch(/Got it/);
  });
});

// -------------------- wrap ---------------------------
describe('wrap command', () => {
  it('rejects non-admin users', async () => {
    const res = await wrapCmd(baseInteraction());
    expect(res.data.content).toMatch(/only server administrators/i);
  });

  it('informs when already wrapped', async () => {
    isWrappedMock.mockReturnValue(true);
    const res = await wrapCmd(adminPermInteraction());
    expect(res.data.content).toMatch(/already active/i);
  });

  it('starts wrap successfully', async () => {
    isWrappedMock.mockReturnValue(false);
    startWrapMock.mockResolvedValue(true);
    const res = await wrapCmd(adminPermInteraction());
    expect(startWrapMock).toHaveBeenCalledWith('guild1');
    expect(res.data.content).toMatch(/started/);
  });

  it('handles failure to start wrap', async () => {
    isWrappedMock.mockReturnValue(false);
    startWrapMock.mockResolvedValue(false);
    const res = await wrapCmd(adminPermInteraction());
    expect(res.data.content).toMatch(/failed/i);
  });
});

// ------------------- unwrap --------------------------
describe('unwrap command', () => {
  it('rejects non-admin users', async () => {
    const res = await unwrapCmd(baseInteraction());
    expect(res.data.content).toMatch(/only server administrators/i);
  });

  it('stops wrap with admin', async () => {
    const res = await unwrapCmd(adminPermInteraction());
    expect(stopWrapMock).toHaveBeenCalledWith('guild1');
    expect(res.data.content).toMatch(/disabled/);
  });
});

// ------------------- update --------------------------
describe('update command', () => {
  it('requires guild id', async () => {
    const res = await updateCmd(undefined);
    expect(res.data.content).toMatch(/must be used inside/i);
  });

  it('handles supabase error', async () => {
    fromMock.mockReturnValueOnce({
      select: () => ({ eq: () => ({ error: new Error('db'), data: null }) }),
    });
    const res = await updateCmd('guild1');
    expect(res.data.content).toMatch(/failed to fetch/i);
  });

  it('handles no data', async () => {
    fromMock.mockReturnValueOnce({
      select: () => ({ eq: () => ({ error: null, data: [] }) }),
    });
    const res = await updateCmd('guild1');
    expect(res.data.content).toMatch(/no wrap data/i);
  });

  it('returns embeds when data present', async () => {
    const sample = [{ user_id: 'u1', top_track: 'Song', top_artist: 'Artist', tracks: [{ id: 't1' }] }];
    fromMock.mockReturnValueOnce({
      select: () => ({ eq: () => ({ error: null, data: sample }) }),
    });
    const res = await updateCmd('guild1');
    expect(res.data.embeds[0].title).toMatch(/Top Tracks/i);
    expect(res.data.embeds[1].title).toMatch(/Top Artists/i);
  });
});
