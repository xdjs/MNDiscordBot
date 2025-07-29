import { InteractionResponseType } from 'discord-interactions';
import { stopWrap } from '../../src/sessions/wrap.js';

export async function unwrap(guildId: string | undefined) {
  if (!guildId) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: '⚠️ This command must be used inside a server.', flags: 64 },
    };
  }

  await stopWrap(guildId);

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: '🛑 Wrap tracking disabled for this server.' },
  };
} 