// @ts-nocheck
const queryMock = jest.fn();
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({ query: queryMock })),
}));

import { fetchArtistLinksByName } from '../../src/services/artistLinks.js';

describe('fetchArtistLinksByName', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('returns first row when found', async () => {
    const row = { id: '1', youtube: 'yt' };
    queryMock.mockResolvedValue({ rows: [row] });
    const res = await fetchArtistLinksByName('Daft Punk');
    expect(res).toEqual(row);
  });

  it('returns null when no rows', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const res = await fetchArtistLinksByName('Unknown');
    expect(res).toBeNull();
  });

  it('returns skip=true on pool limit error', async () => {
    const err = new Error('Max client connections');
    queryMock.mockRejectedValue(err);
    const res = await fetchArtistLinksByName('Busy');
    expect(res).toEqual({ skip: true });
  });
});
