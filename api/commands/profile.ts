import { InteractionResponseType } from 'discord-interactions';
import { supabase } from '../lib/supabase.js';

/**
 * Generates a profile card image and sends it as a follow-up message.
 * Returns a deferred response so the initial slash command is acknowledged within 3 seconds.
 */
export async function profile(interaction: any) {
  const userObj = interaction.member?.user ?? interaction.user;
  const userId = userObj.id;

  // Check if a cached profile card exists
  try {
    const { data: existing } = await supabase
      .from('profiles')
      .select('card_url')
      .eq('user_id', userId)
      .maybeSingle();

    if (existing?.card_url) {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { embeds: [{ image: { url: existing.card_url } }] },
      };
    }
  } catch (err) {
    console.error('[profile] cache lookup error', err);
  }

  // No cached card – inform user and queue generation
  const immediateResponse = {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: '🖼️ Generating your profile card… this may take a minute.',
      flags: 64, // ephemeral so only the user sees it
    },
  };

  try {
    const user = userObj;
    const payload = {
      user_id: user.id,
      username: user.username,
      avatar: user.avatar,
      application_id: interaction.application_id,
      interaction_token: interaction.token,
    };

    console.log('[profile] app', interaction.application_id);
    console.log('[profile] →', process.env.PROFILE_HOOK_URL);
    console.log('[profile] token', interaction.token.slice(0, 8) + '…', 'len', interaction.token.length);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (process.env.PROFILE_HOOK_SECRET) {
        headers['X-Profile-Signature'] = process.env.PROFILE_HOOK_SECRET;
      }

      // 0. Ping health endpoint to wake Render (handles cold starts)
      try {
        const healthUrl = new URL(process.env.PROFILE_HOOK_URL!);
        healthUrl.pathname = '/_health';
        await fetch(healthUrl.toString(), { method: 'GET' }).catch(() => {});
      } catch {/* ignore */}

      const postOnce = () => fetch(process.env.PROFILE_HOOK_URL!, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      const postWithRetry = async () => {
        try {
          return await postOnce();
        } catch (err: any) {
          if (err?.code === 'ECONNRESET') {
            // wait 1s and retry once
            await new Promise((r) => setTimeout(r, 1000));
            return postOnce();
          }
          throw err;
        }
      };

      postWithRetry()
        .then(async (resp) => {
          console.log('[profile] hook status', resp.status);
          const body = await resp.text().catch(() => '');
          if (!resp.ok) {
            console.error('[profile] hook body', body.slice(0, 200));
          }
        })
        .catch((err) => {
          console.error('[profile] fetch error', err);
        });
    } catch (err) {
      console.error('[profile] fetch error', err);
    }
  } catch (err) {
    console.error('[profile] Failed to queue profile hook', err);
  }

  return immediateResponse;
} 