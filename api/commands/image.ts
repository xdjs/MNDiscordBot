import { InteractionResponseType } from 'discord-interactions';
import 'dotenv/config';

/**
 * Queues an image-generation job on Render and immediately returns a deferred response.
 * The heavy lifting happens in the Render service (see /image-hook).
 */
export async function image(interaction: any) {
  // 1. Acknowledge within 3 s so Discord doesn’t time-out
  const deferred = { type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE };

  // 2. Fire-and-forget webhook to Render for image generation
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

    fetch(process.env.IMAGE_HOOK_URL!, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
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

  return deferred;
} 