import { InteractionResponseType } from 'discord-interactions';

/**
 * Resolve the listen-stop webhook URL.
 * If LISTEN_STOP_HOOK_URL is unset, attempt to derive it from LISTEN_HOOK_URL.
 */
function getListenStopUrl(): string | null {
  const explicit = process.env.LISTEN_STOP_HOOK_URL;
  if (explicit) return explicit;

  const listenHook = process.env.LISTEN_HOOK_URL;
  if (!listenHook) return null;

  try {
    const url = new URL(listenHook);
    // Replace the pathname segment – supports both “/listen-hook” and “/listen-hook/” endings.
    url.pathname = url.pathname.replace(/listen-hook\/?$/, 'listen-stop');
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Ends the current listening session for the invoking user.
 */
export async function endlisten(interaction: any) {
  const baseUserObj = interaction.member?.user ?? interaction.user;

  // Default target user is the invoker, may be overridden by option
  let targetUserId = baseUserObj.id;

  const sub = Array.isArray(interaction.data?.options) && interaction.data.options.length
    ? (interaction.data.options[0] as any)
    : null;

  if (sub && Array.isArray(sub.options)) {
    const userOpt = sub.options.find((o: any) => o.name === 'user');
    if (userOpt && typeof userOpt.value === 'string') {
      targetUserId = userOpt.value;
    }
  }

  const payload = {
    user_id: targetUserId,
    channel_id: interaction.channel_id,
    application_id: interaction.application_id,
    interaction_token: interaction.token,
  };

  const stopUrl = getListenStopUrl();

  if (!stopUrl) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: '⚠️ Listening stop feature is not configured on the server.',
        flags: 64,
      },
    };
  }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.LISTEN_STOP_HOOK_SECRET) {
      headers['X-Listen-Signature'] = process.env.LISTEN_STOP_HOOK_SECRET;
    }

    const res = await fetch(stopUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`Listen-stop webhook responded with ${res.status}`);
    }
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
      content: `🛑 Listening session for <@${targetUserId}> has been ended.`,
      flags: 64,
    },
  };
} 