// @ts-nocheck
// Test that supabase client is created with env vars
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ from: jest.fn() })),
}));

describe('supabase lib', () => {
  it('initialises client with env vars', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'KEY';

    // Clear cached module to force re-evaluation with env vars
    jest.resetModules();
    const { supabase } = await import('../../api/lib/supabase.js');

    const { createClient } = await import('@supabase/supabase-js');
    expect(createClient).toHaveBeenCalledWith('https://example.supabase.co', 'KEY');
    expect(supabase).toBeDefined();
  });
});
