import { InteractionResponseType } from 'discord-interactions';
import 'dotenv/config';
import { supabase } from '../lib/supabase.js';

/**
 * Queues an image-generation job on Render and immediately returns a deferred response.
 * The heavy lifting happens in the Render service (see /image-hook).
 */
export async function image(interaction: any) {
  const userId = interaction.member.user.id;

  // 1. Check for cached image
  try {
    const { data: existing } = await supabase
      .from('track_images')
      .select('image_url')
      .eq('user_id', userId)
      .maybeSingle();

    if (existing?.image_url) {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { embeds: [{ image: { url: existing.image_url } }] },
      };
    }
  } catch (cacheErr) {
    console.error('[image] cache lookup error', cacheErr);
  }

  // 2. Send an immediate ephemeral response while generating
  const immediateResponse = {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: '🎨 Generating your personalized image… this may take a minute.',
      flags: 64, // ephemeral so only the user sees it
    },
  };

  // 3. Fire-and-forget webhook to Render for image generation
  try {
    const { user } = interaction.member;
    const payload = {
      user_id: user.id,
      application_id: interaction.application_id,
      interaction_token: interaction.token,
    };

    console.log('[image] app', interaction.application_id);
    console.log('[image] →', process.env.IMAGE_HOOK_URL);
    console.log('[image] token', interaction.token.slice(0, 8) + '…', 'len', interaction.token.length);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.IMAGE_HOOK_SECRET) {
      headers['X-Image-Signature'] = process.env.IMAGE_HOOK_SECRET;
    }

    // Ping health endpoint first to wake Render
    try {
      const healthUrl = new URL(process.env.IMAGE_HOOK_URL!);
      healthUrl.pathname = '/_health';
      await fetch(healthUrl.toString(), { method: 'GET' }).catch(() => {});
    } catch {/* ignore */}

    const postOnce = () => fetch(process.env.IMAGE_HOOK_URL!, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const postWithRetry = async () => {
      try {
        return await postOnce();
      } catch (err: any) {
        if (err?.code === 'ECONNRESET') {
          await new Promise((r) => setTimeout(r, 1000));
          return postOnce();
        }
        throw err;
      }
    };

    postWithRetry()
      .then(async (resp) => {
        console.log('[image] hook status', resp.status);
        const body = await resp.text().catch(() => '');
        if (!resp.ok) {
          console.error('[image] hook body', body.slice(0, 200));
        }
      })
      .catch((err) => {
        console.error('[image] fetch error', err);
      });
  } catch (err) {
    console.error('[image] Failed to queue image hook', err);
  }

  return immediateResponse;
} 