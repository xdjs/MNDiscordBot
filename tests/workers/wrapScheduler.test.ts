// @ts-nocheck
/**
 * Tests for wrapScheduler minute tick logic – verifies that guilds with matching
 * local_time within ±5 minutes are selected and that the daily reset update runs.
 */

jest.useFakeTimers();

// Force timers to execute immediately
let intervalCb: any = null;
jest.spyOn(global, 'setInterval').mockImplementation((cb: any) => {
  intervalCb = cb;
  return 0 as any;
});
jest.spyOn(global, 'setTimeout').mockImplementation(() => 0);

// ------------ dynamic mocks shared between tests ----------------
let selectReturnRows: any[] = [];
const eqFn = jest.fn().mockResolvedValue({ data: [] });
const updateMock = jest.fn().mockReturnValue({ eq: jest.fn() });

const selectMock = jest.fn().mockImplementation(() => ({ error: null, data: selectReturnRows }));

const genericChain = {
  select: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnValue({ eq: jest.fn() }),
  eq: jest.fn().mockReturnValue(Promise.resolve({ data: [] })),
  maybeSingle: jest.fn().mockResolvedValue({ data: null }),
};

const fromMock = jest.fn().mockImplementation((table: string) => {
  if (table === 'wrap_guilds') {
    return {
      select: selectMock,
      update: jest.fn().mockReturnValue({ eq: jest.fn() }),
    } as any;
  }
  if (table === 'user_tracks') {
    return {
      update: updateMock,
      select: jest.fn(() => ({
        eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: { top_track:'Song', top_artist:'Artist', tracks:[], wrap_up:[] } }) })),
      })),
      eq: jest.fn().mockResolvedValue({}),
    } as any;
  }
  return genericChain as any;
});

jest.mock('../../api/lib/supabase.js', () => ({
  supabase: { from: fromMock },
}));

// Mock wrapGuilds set so scheduler sees guild enabled
import { wrapGuilds } from '../../src/sessions/wrap.js';
wrapGuilds.add('guild1');

// Minimal discord.js mocks for client/rest
jest.mock('discord.js', () => {
  const guildStub = {
    channels: { cache: { find: jest.fn(() => null) } },
    systemChannelId: null,
  };
  const clientStub = {
    guilds: { fetch: jest.fn(async () => guildStub) },
  };
  return {
    Client: jest.fn(() => clientStub),
    REST: jest.fn(),
    Routes: {},
    TextChannel: class {},
  };
});

import { initWrapScheduler } from '../../src/workers/wrapScheduler.js';

async function runSchedulerOnce() {
  if (intervalCb) await intervalCb();
  // Flush any pending timers (e.g. setImmediate mocked by fake timers)
  jest.runOnlyPendingTimers();
}

describe('wrapScheduler minute tick', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // timers left as real; spies still active
    jest.setSystemTime(new Date(Date.UTC(2025,0,1,0,2,0)));
    intervalCb = null;
    selectReturnRows = [];
    updateMock.mockClear();
  });

  it('posts and resets for guilds within 5-minute window', async () => {
    selectReturnRows = [
      { guild_id: 'guild1', local_time: '00:00', posted: false }, // diff 2min -> should post
    ];

    const { Client } = require('discord.js');
    const client = new Client();
    initWrapScheduler(client as any, {} as any);

    await runSchedulerOnce();

    // Expect that user_tracks reset ran
    expect(updateMock).toHaveBeenCalled();
  });

  it('skips guilds outside 5-minute window', async () => {
    selectReturnRows = [
      { guild_id: 'guild1', local_time: '00:10', posted: false }, // diff 8min -> skip
    ];

    const client = new (require('discord.js').Client)();
    initWrapScheduler(client as any, {} as any);
    await runSchedulerOnce();

    expect(updateMock).not.toHaveBeenCalled();
  });

  it('skips guilds already posted', async () => {
    selectReturnRows = [
      { guild_id: 'guild1', local_time: '00:00', posted: true }, // already posted
    ];

    const client = new (require('discord.js').Client)();
    initWrapScheduler(client as any, {} as any);
    await runSchedulerOnce();

    expect(updateMock).not.toHaveBeenCalled();
  });
});
