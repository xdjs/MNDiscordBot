import { Express } from 'express';
import { supabase } from '../../api/lib/supabase.js';
import { patchOriginal } from '../utils/discord.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface ProfileHookBody {
  user_id?: string;
  username?: string;
  avatar?: string;
  application_id?: string;
  interaction_token?: string;
}

//register the profile hook (possible to remove)
export function registerProfileHook(app: Express) {
  app.post('/profile-hook', (req, res) => {
    console.log('[profile-hook] hit', new Date().toISOString());

    const {
      user_id: userId,
      username,
      avatar,
      application_id: appId,
      interaction_token: token,
    } = req.body as ProfileHookBody;


    if (!userId || !appId || !token) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Ack quickly so the HTTP request can't time-out
    res.status(202).json({ status: 'accepted' });

    // Continue heavy work asynchronously
    (async () => {
      const avatarUrl = `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png?size=256`;

      let bgUrl: string | null = null;
      try {
        const { data: existing } = await supabase
          .from('profiles')
          .select('card_url, avatar_url, bg_image_url')
          .eq('user_id', userId)
          .single();

        bgUrl = existing?.bg_image_url || null;

        if (existing?.card_url && existing.avatar_url === avatarUrl && bgUrl === existing.bg_image_url) {
          await patchOriginal(appId, token, { embeds: [{ image: { url: existing.card_url } }] });
          return;
        }
      } catch (cacheErr) {
        console.error('[profile-hook] cache lookup error', cacheErr);
      }

      // Build PNG in a worker thread to avoid blocking the main event loop
      import('node:worker_threads').then(async ({ Worker }) => {
        try {
          const pngBuffer: Buffer = await new Promise((resolve, reject) => {
            // Prefer the compiled .js worker in production; fallback to .ts for dev environments running via ts-node/tsx.
            const jsUrl = new URL('../workers/profileCardWorker.js', import.meta.url);
            const tsUrl = new URL('../workers/profileCardWorker.ts', import.meta.url);

            const chosenUrl = existsSync(fileURLToPath(jsUrl)) ? jsUrl : tsUrl;

            const worker = new Worker(chosenUrl, {
              workerData: { username, avatarUrl, bgUrl },
            } as any);
            worker.once('message', resolve);
            worker.once('error', reject);
          });

          await handleUploadAndSend(pngBuffer);
        } catch (err) {
          console.error('[profile-hook] worker error', err);
          await patchOriginal(appId!, token!, { content: 'Failed to generate profile card.' });
        }
      });

      async function handleUploadAndSend(buffer: Buffer) {
        let cardUrl: string | null = null;
        try {
          const timestamp = Date.now();
          const folder = 'cards';
          const newFileName = `${userId}-${timestamp}.png`;
          const filePath = `${folder}/${newFileName}`;

          await supabase.storage
            .from('profile-cards')
            .upload(filePath, buffer, { upsert: false, contentType: 'image/png' });

          const { data } = supabase.storage.from('profile-cards').getPublicUrl(filePath);
          cardUrl = data.publicUrl;

          try {
            const { data: objects } = await supabase.storage
              .from('profile-cards')
              .list(folder);

            if (objects && objects.length) {
              const toDelete = objects
                .filter((o) => o.name !== newFileName && o.name.startsWith(`${userId}`))
                .map((o) => `${folder}/${o.name}`);

              if (toDelete.length) await supabase.storage.from('profile-cards').remove(toDelete);
            }
          } catch (cleanErr) {
            console.error('[profile-hook] cleanup error', cleanErr);
          }
        } catch (uploadErr) {
          console.error('[profile-hook] card upload error', uploadErr);
        }

        if (!cardUrl) {
          await patchOriginal(appId!, token!, { content: 'Failed to generate profile card.' });
          return;
        }

        try {
          await patchOriginal(appId!, token!, { embeds: [{ image: { url: cardUrl } }] });
        } catch (err) {
          console.error('[profile-hook] Failed to send embed', err);
        }

        (async () => {
          try {
            await supabase.from('profiles').upsert({    //adds the profile to the database
              user_id: userId,
              username: username ?? '',
              avatar_url: avatarUrl,
              bg_image_url: bgUrl,
              card_url: cardUrl,
              updated_at: new Date().toISOString(),
            });
          } catch (e) {
            console.error('[profile-hook] Supabase upsert error', e);
          }
        })();
      }
    })();
  });
} 