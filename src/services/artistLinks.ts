import { createClient } from '@supabase/supabase-js';

// Alternate Supabase instance that hosts the artists table
const ALT_URL = process.env.SUPABASE_ALT_URL!;
const ALT_KEY = process.env.SUPABASE_ALT_KEY ?? '';

export const altSupabase = createClient(ALT_URL, ALT_KEY, {
  auth: { persistSession: false },
});

export interface ArtistLinks {
  id: string;
  youtube?: string | null;
  tiktok?: string | null;
  x?: string | null; // formerly Twitter
  instagram?: string | null;
}

/**
 * Fetch social-media links for an artist by case-insensitive name match.
 * Returns null if no row found.
 */
export async function fetchArtistLinksByName(name: string): Promise<ArtistLinks | null> {
  const { data } = await altSupabase
    .from('artists')
    .select('id, youtube, tiktok, x, instagram')
    .ilike('name', name) // simple ILIKE; adjust if you have aliases
    .limit(1)
    .maybeSingle();

  return (data ?? null) as ArtistLinks | null;
} 