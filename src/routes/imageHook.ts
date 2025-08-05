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
  app.post('/image-hook', (req, res) => {
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

    // 1️⃣  Fast-ack — finish the HTTP request immediately so it can’t time-out.
    res.status(202).json({ status: 'accepted' });

    // 2️⃣  Run the heavy work in the background.
    (async () => {
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
        // --- ORIGINAL HEAVY LOGIC STARTS HERE (unchanged except no res.json) ---
        const { data, error } = await supabase
          .from('spotify_tokens')
          .select('access_token, refresh_token')
          .eq('user_id', userId)
          .maybeSingle();

        if (error || !data) {
          await patchOriginal(appId!, token!, {
            content: "You haven't connected your Spotify account yet. Use /connect first!",
          });
          return;
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
            /* ignore, its to swallow any exceptions*/
          }
        }

        if (!topRes.ok) {
          await patchOriginal(appId!, token!, {
            content: 'Failed to fetch your top tracks. Please try again later.',
          });
          return;
        }

        const json = await topRes.json();
        const trackIds: string[] = (json.items ?? []).map((t: any) => t.id);

        // --- Check cache (reuse only if <4 tracks differ) ---
        try {
          const { data: existingImg } = await supabase
            .from('track_images')
            .select('image_url, track_ids')
            .eq('user_id', userId)
            .maybeSingle();

          if (existingImg?.image_url && Array.isArray(existingImg.track_ids)) {
            const prevIds: string[] = existingImg.track_ids as any;

            const diffCount = new Set([
              ...trackIds.filter((id) => !prevIds.includes(id)),
              ...prevIds.filter((id) => !trackIds.includes(id)),
            ]).size;

            if (diffCount < 4) {
              await patchOriginal(appId!, token!, { embeds: [{ image: { url: existingImg.image_url } }] });
              return;
            }
          }
        } catch (cacheErr) {
          console.error('[image-hook] cache lookup error', cacheErr);
        }

        // fall through to image generation when ≥4 tracks changed or no cache exists

        // --- Image generation continues unchanged ---
        const tracksArray: string[] = json.items.map(
          (t: any, i: number) => `${i + 1}. ${t.name} – ${t.artists.map((a: any) => a.name).join(', ')}`,
        );

        //prompt for image generation (thinking of switching it to db for dynamic changing)
        const prompt =
          `Create a cohesive, high-quality WIDE banner image (approx 3-4:1 aspect) that could be used as the background of a small profile card. ` +
          `It should depict a person in their room listening to music that evokes the following track list:\n` +
          tracksArray.join('\n') +
          `\nAvoid placing any critical elements at the extreme edges because the image might be cropped. Do NOT include any textual captions other than incidental song/artist names that could appear on posters or album covers in the scene.`;

        const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
        if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');

        const imgRes = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({ prompt, n: 1, size: '1792x1024', model: 'dall-e-3' }),
        });

        if (!imgRes.ok) {
          await patchOriginal(appId!, token!, { content: 'Failed to generate image. Please try again later.' });
          return;
        }

        const imgJson = await imgRes.json();
        const imageUrlRemote = imgJson.data?.[0]?.url;

        if (!imageUrlRemote) {
          await patchOriginal(appId!, token!, { content: 'Image generation returned no result.' });
          return;
        }

        // --- Persist image to Supabase Storage ---
        let finalUrl = imageUrlRemote;
        try {
          const resp = await fetch(imageUrlRemote);
          const buf = Buffer.from(await resp.arrayBuffer());

          const timestamp = Date.now();
          const folder = 'top_tracks';
          const newFileName = `${userId}-${timestamp}.png`;
          const filePath = `${folder}/${newFileName}`;

          await supabase.storage  //upload the image to supabase storage (bucket)
            .from('track-images')
            .upload(filePath, buf, { upsert: false, contentType: 'image/png' });

          const { data: pub } = supabase.storage.from('track-images').getPublicUrl(filePath);
          if (pub?.publicUrl) {
            finalUrl = pub.publicUrl;
          }

          // cleanup old objects
          try {
            const { data: objects } = await supabase.storage
              .from('track-images')
              .list(folder);

            if (objects && objects.length) {
              const toDelete = objects
                .filter((o) => o.name !== newFileName && o.name.startsWith(`${userId}`))
                .map((o) => `${folder}/${o.name}`);

              if (toDelete.length) {
                await supabase.storage.from('track-images').remove(toDelete);
              }
            }
          } catch (cleanErr) {
            console.error('[image-hook] cleanup error', cleanErr);
          }
        } catch (uploadErr) {
          console.error('[image-hook] image upload error', uploadErr);
        }

        // Send embed to Discord
        await patchOriginal(appId!, token!, { embeds: [{ image: { url: finalUrl } }] });

        // Cache record in DB (fire-and-forget)
        (async () => {
          try {
            const { error: upErr } = await supabase
              .from('track_images')
              .upsert({
                user_id: userId,
                image_url: finalUrl,
                track_ids: trackIds,
                updated_at: new Date().toISOString(),
              })
              .throwOnError();

            if (upErr) console.error('[image-hook] upsert error', upErr);
          } catch (e) {
            console.error('[image-hook] upsert threw', e);
          }
        })();

      } catch (err) {
        console.error('[image-hook] error', err);
        await patchOriginal(appId!, token!, { content: 'Internal server error.' });
      }
      // --- ORIGINAL HEAVY LOGIC ENDS ---
    })();
  });
} 