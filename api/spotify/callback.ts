import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../lib/supabase.js';
import { spotifyClientId, spotifyClientSecret, spotifyRedirectUri } from '../lib/spotify.js';
import 'dotenv/config';

/**
 * Spotify OAuth redirect handler for production (Vercel).
 * Exchanges the `code` for access + refresh tokens and stores them
 * in the `spotify_tokens` table, keyed by the Discord user ID we passed as `state`.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { code, state } = req.query as { [key: string]: string | undefined };

  if (!code || !state) {
    return res.status(400).send('Missing code or state');
  }

  try {
    // Exchange authorization code for tokens
    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', spotifyRedirectUri);

    const basic = Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString('base64');

    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const tokenJson = await tokenRes.json();

    if (!tokenRes.ok) {
      console.error('[spotify/callback] token exchange failed', tokenJson);
      return res.status(500).send('Failed to exchange token');
    }

    // Persist/Update token row
    await supabase.from('spotify_tokens').upsert({
      user_id: state,
      access_token: tokenJson.access_token,
      refresh_token: tokenJson.refresh_token,
      updated_at: new Date().toISOString(),
    });

    // Simple success page
    return res.send(
      '<html><body style="font-family:sans-serif;text-align:center;padding-top:40px">✅ Spotify linked! You can close this tab.<script>window.close()</script></body></html>',
    );
  } catch (err) {
    console.error('[spotify/callback] error', err);
    return res.status(500).send('Internal server error');
  }
}

export const config = {
  api: {
    bodyParser: false, // keep raw body
  },
}; 