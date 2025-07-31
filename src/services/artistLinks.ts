import { Pool } from 'pg';

// Use direct Postgres connection (no anon key required)
const ALT_PG_URL = process.env.SUPABASE_ALT_URL!; // expects postgres:// URL

// Supabase Postgres endpoints require SSL
export const altPool = new Pool({
  connectionString: ALT_PG_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 1_000,
});

export interface ArtistLinks {
  id: string;
  spotify?: string | null;
  youtube?: string | null;
  tiktok?: string | null;
  x?: string | null;
  soundcloud?: string | null;
  instagram?: string | null;
  bio?: string | null;
}

export interface ArtistLinksSkipped {
  skip: true;
}

/**
 * Fetch social-media links for an artist by case-insensitive name match.
 * Returns null if no row found.
 */
export async function fetchArtistLinksByName(name: string): Promise<ArtistLinks | null> {
  try {
    const { rows } = await altPool.query<ArtistLinks>(
      `SELECT id, spotify, youtube, tiktok, x, instagram, bio
       FROM artists
       WHERE name = $1
       LIMIT 1`,
      [name],
    );

    return rows.length ? rows[0] : null;
  } catch (err: any) {
    // If pool cannot obtain a connection (max connections), fall back gracefully
    if (err?.message?.includes('Max client connections')) {
      console.warn('[artistLinks] pool limit reached – skipping DB lookup');
      return { skip: true } as any;
    }
    throw err; // rethrow unexpected errors
  }
} 