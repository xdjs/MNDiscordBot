// @ts-nocheck
/**
 * Tests that after posting a wrap, the scheduler adds the interval value to local_time.
 */

jest.useFakeTimers();

let intervalCb: any = null;
jest.spyOn(global, 'setInterval').mockImplementation((cb: any) => {
  intervalCb = cb;
  return 0 as any;
});
jest.spyOn(global, 'setTimeout').mockImplementation(() => 0);

// ------------ dynamic mocks ---------------
let selectRows: any[] = [];
const updateWrapMock = jest.fn().mockReturnValue({ eq: jest.fn() });
const maybeSingleMock = jest.fn();

const fromMock = jest.fn().mockImplementation((table: string) => {
  if (table === 'wrap_guilds') {
    return {
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn().mockResolvedValue({ data: { wrap_up: [], local_time: '04:00:00', interval: 3 } }),
        })),
        error: null,
        data: selectRows,
      })),
      update: updateWrapMock,
    } as any;
  }
  if (table === 'Summary_prompts') {
    return {
      select: jest.fn(() => ({
        limit: jest.fn(() => ({
          single: jest.fn().mockResolvedValue({ data: { prompt: ['Mock Prompt'], emoji: ['😀'] }, error: null }),
        })),
      })) as any,
    } as any;
  }
  if (table === 'user_tracks') {
    return {
      select: jest.fn(() => ({
        eq: jest.fn().mockReturnValue({
          data: [
            {
              user_id: 'u1',
              username: 'User',
              top_track: 'Song',
              top_artist: 'Artist',
              tracks: [{ id: 't1' }],
              last_updated: '2025-01-01T00:00:00Z',
            },
          ],
        }),
      })),
      update: jest.fn(() => ({ eq: jest.fn().mockResolvedValue({}) })),
    } as any;
  }
  // default mock chain
  return {
    select: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnValue({ eq: jest.fn() }),
    eq: jest.fn().mockReturnValue({ data: [] }),
  } as any;
});

jest.mock('../../api/lib/supabase.js', () => ({
  supabase: { from: fromMock },
}));

// Mock wrapGuilds set
import { wrapGuilds } from '../../src/sessions/wrap.js';
wrapGuilds.add('guild1');

// discord.js stubs
jest.mock('discord.js', () => {
  const guildStub = {
    channels: { cache: { find: jest.fn(() => null) } },
    systemChannelId: 'sys1',
  };
  const clientStub = {
    guilds: { fetch: jest.fn(async () => guildStub) },
  };
  return {
    Client: jest.fn(() => clientStub),
    REST: jest.fn(),
    Routes: { channelMessages: jest.fn(() => '/channels/123/messages') },
    TextChannel: class {},
  };
});

import { initWrapScheduler } from '../../src/workers/wrapScheduler.js';

async function runTick() {
  if (intervalCb) await intervalCb();
  jest.runOnlyPendingTimers();
}

describe('Scheduler interval adjustment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    updateWrapMock.mockClear();
    intervalCb = null;
    // Set time to 04:01 UTC so diff <=5 from 04:00
    jest.setSystemTime(new Date(Date.UTC(2025, 0, 1, 4, 1, 0)));

    selectRows = [
      { guild_id: 'guild1', local_time: '04:00', posted: false },
    ];

    // maybeSingle should return current local_time and interval 3
    maybeSingleMock.mockResolvedValue({ data: { local_time: '04:00:00', interval: 3 } });
  });

  it('advances local_time by interval hours', async () => {
    const client = new (require('discord.js').Client)();
    const restMock = { post: jest.fn() };
    initWrapScheduler(client as any, restMock as any);

    await runTick();

    // First call to updateWrapMock should include new local_time 07:00:00
    const payload = updateWrapMock.mock.calls[0][0];
    expect(payload.local_time).toBe('07:00:00');
  });
});
