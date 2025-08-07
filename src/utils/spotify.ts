import 'dotenv/config';

interface TokenCache {
  token: string;
  expires: number; // epoch ms
}

let cached: TokenCache | null = null;

/**
 * Retrieve (and cache) an app-only Spotify API bearer token using the Client Credentials flow.
 * Returns null if credentials are missing or the request fails.
 */
export async function getSpotifyToken(): Promise<string | null> {
  const now = Date.now();
  if (cached && cached.expires > now + 30_000) return cached.token;

  const { SPOTIFY_CLIENT_ID: id, SPOTIFY_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) {
    console.warn('[spotify] Missing client credentials – skipping API lookup');
    return null;
  }

  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!res.ok) {
      console.warn('[spotify] token request failed', res.status);
      return null;
    }

    const json: any = await res.json();
    cached = {
      token: json.access_token,
      expires: now + (json.expires_in ?? 3600) * 1000,
    };
    return cached.token;
  } catch (err) {
    console.error('[spotify] token fetch error', err);
    return null;
  }
}

/**
 * Fetch canonical artist names for a track by Spotify ID.
 * Returns null on failure.
 */
export async function fetchArtistsByTrackId(trackId: string): Promise<string[] | null> {
  const token = await getSpotifyToken();
  if (!token) return null;
  try {
    const res = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.warn('[spotify] track lookup failed', res.status);
      return null;
    }
    const json: any = await res.json();
    if (!Array.isArray(json.artists)) return null;
    return json.artists.map((a: any) => a.name).filter(Boolean);
  } catch (err) {
    console.error('[spotify] track fetch error', err);
    return null;
  }
}
