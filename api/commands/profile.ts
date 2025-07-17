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

    console.log('[profile] →', process.env.PROFILE_HOOK_URL);

    try {
      const resp = await fetch(process.env.PROFILE_HOOK_URL!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Profile-Signature': process.env.PROFILE_HOOK_SECRET ?? '',
        },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        console.error(`[profile] hook responded ${resp.status}: ${text}`);
      }
    } catch (err) {
      console.error('[profile] fetch error', err);
    }
  } catch (err) {
    console.error('[profile] Failed to queue profile hook', err);
  }

  return deferred;
} 