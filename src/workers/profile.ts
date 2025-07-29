import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { supabase } from '../../api/lib/supabase.js';
import { patchOriginal } from '../utils/discord.js';

export interface ProfileJobPayload {
  user_id: string;
  username?: string;
  avatar?: string;
  application_id: string;
  interaction_token: string;
  bg_image_url?: string | null;
}

export async function runProfileJob(payload: ProfileJobPayload) {
  const { user_id: userId, username, avatar, application_id: appId, interaction_token: token, bg_image_url: bgUrlInput } = payload;

  const avatarUrl = avatar ? `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png?size=256` : undefined;

  let bgUrl: string | null = bgUrlInput ?? null;
  
  // Preserve reference to any existing profile record
  let existing: { card_url?: string | null; avatar_url?: string | null; bg_image_url?: string | null } | null = null;
  
  // Check cache first & fetch existing record
  try {
    const { data } = await supabase
      .from('profiles')
      .select('card_url, avatar_url, bg_image_url')
      .eq('user_id', userId)
      .maybeSingle();

    existing = data ?? null;

    // If bg image not passed in payload, fall back to stored value
    if (!bgUrl && existing?.bg_image_url) {
      bgUrl = existing.bg_image_url;
    }

    // If we already have a cached card that matches the current avatar + background, just reuse it.
    if (existing?.card_url && existing.avatar_url === avatarUrl && existing.bg_image_url === bgUrl) {
      await patchOriginal(appId, token, { embeds: [{ image: { url: existing.card_url } }] });
      return;
    }
  } catch (cacheErr) {
    console.error('[profile-worker] cache lookup error', cacheErr);
  }

  // Build PNG in a worker thread
  const { Worker } = await import('node:worker_threads');
  try {
    const pngBuffer: Buffer = await new Promise((resolve, reject) => {
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
    console.error('[profile-worker] worker error', err);
    await patchOriginal(appId, token, { content: 'Failed to generate profile card.' });
  }

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

      // Cleanup old files
      try {
        const { data: objects } = await supabase.storage.from('profile-cards').list(folder);
        if (objects?.length) {
          const toDelete = objects
            .filter((o) => o.name !== newFileName && o.name.startsWith(`${userId}`))
            .map((o) => `${folder}/${o.name}`);
          if (toDelete.length) await supabase.storage.from('profile-cards').remove(toDelete);
        }
      } catch (cleanErr) {
        console.error('[profile-worker] cleanup error', cleanErr);
      }
    } catch (uploadErr) {
      console.error('[profile-worker] card upload error', uploadErr);
    }

    if (!cardUrl) {
      await patchOriginal(appId, token, { content: 'Failed to generate profile card.' });
      return;
    }

    try {
      await patchOriginal(appId, token, { embeds: [{ image: { url: cardUrl } }] });
    } catch (sendErr) {
      console.error('[profile-worker] Failed to send embed', sendErr);
    }

    // Update DB cache
    (async () => {
      try {
        await supabase.from('profiles').upsert({
          user_id: userId,
          username: username ?? '',
          avatar_url: avatarUrl,
          bg_image_url: bgUrl,
          card_url: cardUrl,
          updated_at: new Date().toISOString(),
        });
      } catch (e) {
        console.error('[profile-worker] Supabase upsert error', e);
      }
    })();
  }
} 