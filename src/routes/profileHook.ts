import { Express } from 'express';
import { Canvas, loadImage } from 'skia-canvas';
import { supabase } from '../../api/lib/supabase.js';
import { patchOriginal } from '../utils/discord.js';

interface ProfileHookBody {
  user_id?: string;
  username?: string;
  avatar?: string;
  application_id?: string;
  interaction_token?: string;
}

export function registerProfileHook(app: Express) {
  app.post('/profile-hook', async (req, res) => {
    console.log('[profile-hook] hit', new Date().toISOString());

    const {
      user_id: userId,
      username,
      avatar,
      application_id: appId,
      interaction_token: token,
    } = req.body as ProfileHookBody;

    // Optional shared-secret check
    const secret = process.env.PROFILE_HOOK_SECRET;
    if (secret && req.get('x-profile-signature') !== secret) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    if (!userId || !appId || !token) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const avatarUrl = `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png?size=256`;

    // --- Reuse cached card if avatar hasn't changed ---
    let bgUrl: string | null = null;
    let bgImg: any = null;
    try {
      const { data: existing } = await supabase
        .from('profiles')
        .select('card_url, avatar_url, bg_image_url')
        .eq('user_id', userId)
        .single();

      bgUrl = existing?.bg_image_url || null;

      if (existing?.card_url && existing.avatar_url === avatarUrl && bgUrl === existing.bg_image_url) {
        // Send embed with cached image URL and exit early
        await patchOriginal(appId, token, { embeds: [{ image: { url: existing.card_url } }] });
        return res.json({ status: 'cached' });
      }
    } catch (cacheErr) {
      console.error('[profile-hook] cache lookup error', cacheErr);
      // fall through to regenerate
    }

    // If bg image set, load it
    if (typeof bgUrl === 'string') {
      try {
        bgImg = await loadImage(bgUrl);
      } catch (err) {
        console.error('[profile-hook] Failed to load bg image', err);
      }
    }

    // Build card
    const width = 550;
    const height = 160;
    const canvas = new Canvas(width, height);
    const ctx: any = canvas.getContext('2d');

    const roundRect = (ctx: any, x: number, y: number, w: number, h: number, r: number) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h - r);
      ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.lineTo(x + r, y + h);
      ctx.arcTo(x, y + h, x, y + h - r, r);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
      ctx.fill();
    };

    // Background
    if (bgImg) {
      ctx.save();
      ctx.beginPath();
      roundRect(ctx, 0, 0, width, height, 18);
      ctx.clip();
      ctx.drawImage(bgImg, 0, 0, width, height);
      ctx.restore();
    } else {
      ctx.fillStyle = '#1e1e1e';
      roundRect(ctx, 0, 0, width, height, 18);
    }

    // Avatar drawing (bottom-left)
    const avatarSize = 60;
    const avatarX = 22;
    const avatarY = height - avatarSize - 22; // 22px bottom margin
    try {
      const img = await loadImage(avatarUrl);
      ctx.save();
      ctx.beginPath();
      ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, avatarX, avatarY, avatarSize, avatarSize);
      ctx.restore();
    } catch (err) {
      console.error('[profile-hook] Avatar load error', err);
    }

    // Status circle (scaled with avatar)
    ctx.fillStyle = '#3ba55d';
    const dotR = 6;
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize - dotR, avatarY + avatarSize - dotR, dotR, 0, Math.PI * 2);
    ctx.fill();

    // Username text aligned to bottom
    ctx.font = 'bold 42px Sans';
    ctx.textBaseline = 'bottom';
    const textY = height - 22; // 22px bottom padding to match avatar

    // Draw black outline first
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#000000';
    ctx.strokeText(username ?? 'Unknown', avatarX + avatarSize + 30, textY);

    // Fill white text on top
    ctx.fillStyle = '#ffffff';
    ctx.fillText(username ?? 'Unknown', avatarX + avatarSize + 30, textY);

    const buffer: Buffer = await (canvas as any).png;

    // --- Upload card to Supabase Storage ---
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

      // --- Delete older cards for this user ---
      try {
        const { data: objects } = await supabase.storage
          .from('profile-cards')
          .list(folder);

        if (objects && objects.length) {
          const toDelete = objects
            .filter((o) => o.name !== newFileName && o.name.startsWith(`${userId}`))
            .map((o) => `${folder}/${o.name}`);

          if (toDelete.length) {
            await supabase.storage.from('profile-cards').remove(toDelete);
          }
        }
      } catch (cleanErr) {
        console.error('[profile-hook] cleanup error', cleanErr);
      }
    } catch (uploadErr) {
      console.error('[profile-hook] card upload error', uploadErr);
    }

    // Fallback: if upload failed, skip sending
    if (!cardUrl) {
      return res.status(500).json({ error: 'Failed to upload card' });
    }

    // Send follow-up message via embed
    try {
      await patchOriginal(appId!, token!, { embeds: [{ image: { url: cardUrl } }] });
    } catch (err) {
      console.error('[profile-hook] Failed to send embed', err);
    }

    // Upsert profile row with new card_url (fire-and-forget)
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
      } catch (e: any) {
        console.error('[profile-hook] Supabase upsert error', e);
      }
    })();

    res.json({ status: 'queued' });
  });
} 