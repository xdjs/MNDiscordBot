import { InteractionResponseType } from 'discord-interactions';

/**
 * Ends the current listening session for the invoking user.
 */
export async function endlisten(interaction: any) {
  const userObj = interaction.member?.user ?? interaction.user;
  const userId = userObj.id;

  const payload = {
    user_id: userId,
    channel_id: interaction.channel_id,
    application_id: interaction.application_id,
    interaction_token: interaction.token,
  };

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.LISTEN_STOP_HOOK_SECRET) {
      headers['X-Listen-Signature'] = process.env.LISTEN_STOP_HOOK_SECRET;
    }

    await fetch(process.env.LISTEN_STOP_HOOK_URL!, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[endlisten] fetch error', err);
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: 'Failed to end your listening session. Please try again.',
        flags: 64,
      },
    };
  }

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: '🛑 Your listening session has been ended.',
      flags: 64,
    },
  };
} 