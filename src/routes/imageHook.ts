import { Express } from 'express';
import { supabase } from '../../api/lib/supabase.js';
import { spotifyClientId, spotifyClientSecret } from '../../api/lib/spotify.js';
import { patchOriginal } from '../utils/discord.js';

interface ImageHookBody {
  user_id?: string;
  application_id?: string;
  interaction_token?: string;
}

export function registerImageHook(app: Express) {
  app.post('/image-hook', async (req, res) => {
    console.log('[image-hook] hit', new Date().toISOString());

    const { user_id: userId, application_id: appId, interaction_token: token } =
      req.body as ImageHookBody;

    // Optional shared-secret check
    const secret = process.env.IMAGE_HOOK_SECRET;
    if (secret && req.get('x-image-signature') !== secret) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    if (!userId || !appId || !token) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const fetchTopTracks = (accessToken: string) =>
      fetch('https://api.spotify.com/v1/me/top/tracks?limit=10&time_range=medium_term', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

    const refreshSpotifyToken = async (refreshToken: string) => {
      const params = new URLSearchParams();
      params.append('grant_type', 'refresh_token');
      params.append('refresh_token', refreshToken);

      const basic = Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString('base64');
      const resp = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
      if (!resp.ok) throw new Error('Failed to refresh');
      return resp.json() as Promise<{ access_token: string }>;
    };

    try {
      // Fetch Spotify tokens
      const { data, error } = await supabase
        .from('spotify_tokens')
        .select('access_token, refresh_token')
        .eq('user_id', userId)
        .maybeSingle();

      if (error || !data) {
        await patchOriginal(appId!, token!, {
          content: "You haven't connected your Spotify account yet. Use /connect first!",
        });
        return res.json({ status: 'no_spotify' });
      }

      let { access_token: accessToken, refresh_token: refreshToken } = data as any;
      let topRes = await fetchTopTracks(accessToken);

      if (topRes.status === 401 && refreshToken) {
        try {
          const refreshed = await refreshSpotifyToken(refreshToken);
          accessToken = refreshed.access_token;
          await supabase
            .from('spotify_tokens')
            .update({ access_token: accessToken, updated_at: new Date().toISOString() })
            .eq('user_id', userId);
          topRes = await fetchTopTracks(accessToken);
        } catch {
          /* ignore */
        }
      }

      if (!topRes.ok) {
        await patchOriginal(appId!, token!, {
          content: 'Failed to fetch your top tracks. Please try again later.',
        });
        return res.json({ status: 'spotify_fail' });
      }

      // --- Check cache ---
      try {
        const { data: existingImg } = await supabase
          .from('track_images')
          .select('image_url')
          .eq('user_id', userId)
          .maybeSingle();

        if (existingImg?.image_url) {
          await patchOriginal(appId!, token!, { embeds: [{ image: { url: existingImg.image_url } }] });
          return res.json({ status: 'cached' });
        }
      } catch (cacheErr) {
        console.error('[image-hook] cache lookup error', cacheErr);
      }

      const json = await topRes.json();
      const tracksArray: string[] = json.items.map(
        (t: any, i: number) => `${i + 1}. ${t.name} – ${t.artists.map((a: any) => a.name).join(', ')}`,
      );
      const prompt =
        `Create a cohesive, high-quality personlized picture of someone (a person listening in their room) listening to the following songs:\n` +
        tracksArray.join('\n') +
        `\nDo not include any text in the image, other than the song/artist names that could be on posters, cds, etc.`;

      const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
      if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');

      const imgRes = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({ prompt, n: 1, size: '1024x1024', model: 'dall-e-3' }),
      });

      if (!imgRes.ok) {
        await patchOriginal(appId!, token!, { content: 'Failed to generate image. Please try again later.' });
        return res.json({ status: 'openai_fail' });
      }

      const imgJson = await imgRes.json();
      const imageUrlRemote = imgJson.data?.[0]?.url;

      if (!imageUrlRemote) {
        await patchOriginal(appId!, token!, { content: 'Image generation returned no result.' });
        return res.json({ status: 'no_image' });
      }

      // --- Persist image to Supabase Storage ---
      let finalUrl = imageUrlRemote;
      try {
        const resp = await fetch(imageUrlRemote);
        const buf = Buffer.from(await resp.arrayBuffer());
        const filePath = `top_tracks/${userId}.png`;
        await supabase.storage
          .from('track-images')
          .upload(filePath, buf, { upsert: true, contentType: 'image/png' });

        const { data: pub } = supabase.storage.from('track-images').getPublicUrl(filePath);
        if (pub?.publicUrl) {
          finalUrl = pub.publicUrl;
        }
      } catch (uploadErr) {
        console.error('[image-hook] image upload error', uploadErr);
      }

      // Send embed
      await patchOriginal(appId!, token!, { embeds: [{ image: { url: finalUrl } }] });

      // Cache record in DB (fire-and-forget)
      (async () => {
        try {
          await supabase.from('track_images').upsert({
            user_id: userId,
            image_url: finalUrl,
            updated_at: new Date().toISOString(),
          });
        } catch (err) {
          console.error('[image-hook] upsert error', err);
        }
      })();

      return res.json({ status: 'done' });
    } catch (err) {
      console.error('[image-hook] error', err);
      return res.status(500).json({ error: 'internal' });
    }
  });
} 