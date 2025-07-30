// @ts-nocheck

// Supabase stub must be defined before jest.mock uses it
const chain = {
  upsert: jest.fn().mockResolvedValue({ error: null }),
  delete: jest.fn().mockReturnValue({ eq: jest.fn() }),
  select: jest.fn().mockResolvedValue({ data: [] }),
};
const supabaseStub = { from: jest.fn().mockReturnValue(chain) };

jest.mock('../../api/lib/supabase.js', () => ({ supabase: supabaseStub }));

import { wrapGuilds, isWrapped, startWrap, stopWrap } from '../../src/sessions/wrap.js';

describe('wrap sessions', () => {
  beforeEach(() => {
    wrapGuilds.clear();
    jest.clearAllMocks();
  });

  it('startWrap adds guild and persists via upsert', async () => {
    const success = await startWrap('g1');
    expect(success).toBe(true);
    expect(wrapGuilds.has('g1')).toBe(true);
    expect(supabaseStub.from).toHaveBeenCalledWith('wrap_guilds');
    expect(chain.upsert).toHaveBeenCalled();
  });

  it('stopWrap removes guild and deletes via supabase', async () => {
    wrapGuilds.add('g1');
    await stopWrap('g1');
    expect(wrapGuilds.has('g1')).toBe(false);
    expect(chain.delete).toHaveBeenCalled();
  });
});
