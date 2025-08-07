// @ts-nocheck
/**
 * Tests the Vercel API handler for Discord interactions, focusing on MESSAGE_COMPONENT
 * paths (wrap_artist_ and navigation arrows). Signature verification and Discord constants
 * are mocked for isolation.
 */

import { EventEmitter } from 'events';

// --------------- Mocks -----------------------------
const verifyKeyMock = jest.fn(() => true);

jest.mock('discord-interactions', () => ({
  verifyKey: (...args: any[]) => verifyKeyMock(...args),
  InteractionType: { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3 },
  InteractionResponseType: {
    PONG: 10,
    CHANNEL_MESSAGE_WITH_SOURCE: 4,
    UPDATE_MESSAGE: 7,
  },
}));

// Mock fetchArtistLinksByName so artist bio path works
const fetchArtistLinksMock = jest.fn();
jest.mock('../../src/services/artistLinks.js', () => ({
  fetchArtistLinksByName: (name: string) => fetchArtistLinksMock(name),
}));

// Mock wrapPaginator build function so nav path doesn't depend on embed logic
const buildWrapPayloadMock = jest.fn(() => ({ embeds: [{ title: 'Stub' }], components: [] }));
jest.mock('../../src/utils/wrapPaginator.js', () => ({
  buildWrapPayload: (...args: any[]) => buildWrapPayloadMock(...args),
}));

// Supabase mock for snapshot retrieval in nav path
const maybeSingleMock = jest.fn().mockResolvedValue({ data: { wrap_tracks: [{ user_id: 'u1', top_track: 'Song', spotify_track_id: 't1' }] } });
const selectMock = jest.fn(() => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }));
const fromMock = jest.fn(() => ({ select: selectMock }));

jest.mock('../../api/lib/supabase.js', () => ({
  supabase: { from: fromMock },
}));

// pickRandomEmoji is called inside handler but we can stub supabase to return empty to avoid issues.

// ------------ Helper to build mock req/res ----------
function createMockReq(bodyObj: any) {
  const bodyBuf = Buffer.from(JSON.stringify(bodyObj));
  const emitter = new EventEmitter();
  // implement async iterator over body buffer
  async function* asyncIter() {
    yield bodyBuf;
  }
  (emitter as any)[Symbol.asyncIterator] = asyncIter;
  (emitter as any).headers = {
    'x-signature-ed25519': 'sig',
    'x-signature-timestamp': 'ts',
  };
  return emitter as any;
}

function createMockRes() {
  const res: any = {
    statusCode: 0,
    jsonData: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.jsonData = payload;
      return this;
    },
    send(payload: any) {
      this.jsonData = payload;
      return this;
    },
  };
  return res;
}

// --------- Import handler AFTER mocks ---------------
import handler from '../../api/discord.js';

describe('Discord API handler – MESSAGE_COMPONENT paths', () => {
  it('returns artist bio response for wrap_artist_ component', async () => {
    fetchArtistLinksMock.mockResolvedValue({ id: 'a1', bio: 'Great artist', youtube: 'yt' });

    const interaction = {
      type: 3,
      data: { custom_id: 'wrap_artist_Taylor Swift' },
      guild_id: 'g1',
    };

    const req = createMockReq(interaction);
    const res = createMockRes();

    await handler(req as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.type).toBe(4); // CHANNEL_MESSAGE_WITH_SOURCE
    expect(res.jsonData.data.content).toContain('Taylor Swift');
    expect(fetchArtistLinksMock).toHaveBeenCalledWith('Taylor Swift');
  });

  it('returns UPDATE_MESSAGE for navigation component and builds payload', async () => {
    const interaction = {
      type: 3,
      data: { custom_id: 'wrap_next_0' },
      guild_id: 'g1',
      message: { embeds: [{ title: 'Top Tracks Today', description: 'Daily Summary\n\nLine1', color: 0x2f3136 }] },
    };

    const req = createMockReq(interaction);
    const res = createMockRes();

    await handler(req as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.type).toBe(7); // UPDATE_MESSAGE
    expect(buildWrapPayloadMock).toHaveBeenCalled();
  });
});
