import { InteractionResponseType } from 'discord-interactions';

/**
 * Generates a profile card image and sends it as a follow-up message.
 * Returns a deferred response so the initial slash command is acknowledged within 3 seconds.
 */
export async function profile(interaction: any) {
  // 1. Acknowledge interaction right away
  const deferred = { type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE };

  // 2. Fire-and-forget webhook to Render for heavy lifting
  try {
    const { user } = interaction.member;
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

      fetch(process.env.PROFILE_HOOK_URL!, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })
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

  return deferred;
} 