/*import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../lib/supabase.js';
import { spotifyClientId, spotifyClientSecret, spotifyRedirectUri } from '../lib/spotify.js';
import 'dotenv/config';

/**
 * Spotify OAuth redirect handler for production (Vercel).
 * Exchanges the `code` for access + refresh tokens and stores them
 * in the `spotify_tokens` table, keyed by the Discord user ID we passed as `state`.
 
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

    // Ensure a profiles row exists
    const { data: prof } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('user_id', state)
      .maybeSingle();

    if (!prof) {
      // Fetch basic user data from Discord to satisfy NOT NULL username column
      const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
      let username: string | null = null;
      let avatar: string | null = null;
      if (BOT_TOKEN) {
        try {
          const uRes = await fetch(`https://discord.com/api/v10/users/${state}`, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` },
          });
          if (uRes.ok) {
            const uj = await uRes.json();
            username = uj.username ?? null;
            avatar = uj.avatar ?? null;
          }
        } catch {/* ignore }
      }

      await supabase
        .from('profiles')
        .insert({
          user_id: state,
          username: username ?? 'Unknown',
          avatar_url: avatar ? `https://cdn.discordapp.com/avatars/${state}/${avatar}.png` : null,
          updated_at: new Date().toISOString(),
        })
        .throwOnError();
    }

    // Simple success page
    return res.send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Spotify linked</title>
    <style>
      body {
        font-family: sans-serif;
        text-align: center;
        padding-top: 40px;
        background: #121212;
        color: #fff;
      }
      .btn {
        margin-top: 24px;
        padding: 10px 20px;
        border: none;
        border-radius: 4px;
        background: #1DB954;
        color: #fff;
        font-size: 16px;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <h1>✅ Spotify linked!</h1>
    <p>You can now return to Discord.</p>
    <button class="btn" onclick="window.close()">Close this tab</button>
  </body>
</html>`);
  } catch (err) {
    console.error('[spotify/callback] error', err);
    return res.status(500).send('Internal server error');
  }
}

export const config = {
  api: {
    bodyParser: false, // keep raw body
  },
}; */