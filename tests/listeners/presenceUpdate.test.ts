// @ts-nocheck
import { EventEmitter } from 'events';

// -------------------- Mocks -------------------------

// Capture Supabase call chains
const upsertMock = jest.fn().mockResolvedValue({});
const selectMock = jest.fn().mockReturnThis();
const eqMock = jest.fn().mockReturnThis();
const maybeSingleMock = jest.fn().mockResolvedValue({ data: null });

const fromMock = jest.fn().mockReturnValue({
  select: selectMock,
  eq: eqMock,
  maybeSingle: maybeSingleMock,
  upsert: upsertMock,
});

jest.mock('../../api/lib/supabase.js', () => ({
  supabase: { from: fromMock },
}));

// Mock isWrapped to always return true so the listener logic proceeds
jest.mock('../../src/sessions/wrap.js', () => ({
  isWrapped: jest.fn(() => true),
}));

// Mock minimal discord.js surface needed by presenceUpdate listener
let clientEmitter: EventEmitter;

jest.mock('discord.js', () => {
  // Fresh emitter per test so we can attach/emit events.
  clientEmitter = new (require('events').EventEmitter)();
  return {
    // The Client constructor returns the emitter instance
    Client: jest.fn(() => clientEmitter),
    REST: jest.fn(),
    ActivityType: { Listening: 'LISTENING' },
  };
});

// -------------------- Imports (after mocks set) ----------------------
import { registerPresenceListener } from '../../src/listeners/presenceUpdate.js';
import { ActivityType } from 'discord.js';

// --------------------------- Helpers --------------------------------
function emitPresence(activity: any) {
  const newPresence = {
    userId: 'user1',
    guild: { id: 'guild1' },
    activities: [activity],
    user: { username: 'TestUser' },
  } as any;
  // oldPresence isn’t used in listener, pass null
  clientEmitter.emit('presenceUpdate', null, newPresence);
}

// ------------------------- Tests ------------------------------------
describe('presenceUpdate listener', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Remove previous listeners to avoid duplicate handler invocations
    clientEmitter.removeAllListeners();
    // Re-register listener for this test
    registerPresenceListener(clientEmitter as any, {} as any);
  });

  it('skips Spotify activity without trackId (likely podcast)', async () => {
    const activity = {
      type: ActivityType.Listening,
      name: 'Spotify',
      details: 'Podcast Episode',
      state: 'Show Name',
      // syncId absent to simulate podcast
    };

    emitPresence(activity);
    // Wait micro-tasks to flush async handler
    await new Promise((r) => setImmediate(r));

    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('logs Spotify activity with trackId', async () => {
    const activity = {
      type: ActivityType.Listening,
      name: 'Spotify',
      details: 'Song A',
      state: 'Artist A',
      syncId: 'track123',
    };

    emitPresence(activity);
    await new Promise((r) => setImmediate(r));

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const arg = upsertMock.mock.calls[0][0];
    expect(arg.tracks[arg.tracks.length - 1].id).toBe('track123');
  });

  it('logs Apple Music activity even without trackId', async () => {
    const activity = {
      type: ActivityType.Listening,
      name: 'Apple Music',
      details: 'Song B',
      state: 'Artist B',
      // syncId missing – Apple Music doesn’t provide one
    };

    emitPresence(activity);
    await new Promise((r) => setImmediate(r));

    expect(upsertMock).toHaveBeenCalledTimes(1);
  });
});
