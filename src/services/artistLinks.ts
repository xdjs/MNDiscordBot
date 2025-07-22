import { Pool } from 'pg';

// Use direct Postgres connection (no anon key required)
const ALT_PG_URL = process.env.SUPABASE_ALT_URL!; // expects postgres:// URL

// Supabase Postgres endpoints require SSL
export const altPool = new Pool({
  connectionString: ALT_PG_URL,
  ssl: { rejectUnauthorized: false },
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
  const { rows } = await altPool.query<ArtistLinks>(
    `SELECT id, youtube, tiktok, x, instagram
     FROM artists
     WHERE LOWER(name) = LOWER($1)
     LIMIT 1`,
    [name],
  );

  return rows.length ? rows[0] : null;
} 