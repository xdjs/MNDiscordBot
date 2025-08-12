// @ts-nocheck
// Test that supabase client is created with env vars
// The code now requires SUPABASE_PG_URL; stub it to avoid throw
beforeAll(() => {
  process.env.SUPABASE_PG_URL = 'postgres://user:pass@host:5432/db';
});

describe('supabase lib', () => {
  it('initialises client with env vars', async () => {
    // The new supabase lib uses direct PG via SUPABASE_PG_URL, just verify it exports without throwing
    jest.resetModules();
    const mod = await import('../../api/lib/supabase.js');
    expect(mod.supabase).toBeDefined();
  });
});
