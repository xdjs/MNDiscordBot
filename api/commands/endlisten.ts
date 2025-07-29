import { InteractionResponseType } from 'discord-interactions';
import { sessions } from '../../src/sessions/listen.js';

/**
 * Ends the current listening session for the given user (defaults to invoker).
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

  // Remove the session if present, clearing timeout first
  const session = sessions.get(targetUserId);
  if (session?.timeout) {
    clearTimeout(session.timeout);
  }
  const hadSession = sessions.delete(targetUserId);

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: hadSession
        ? `🛑 Listening session for <@${targetUserId}> has been ended.`
        : `ℹ️ No active listening session found for <@${targetUserId}>.`,
      flags: 64,
    },
  };
} 