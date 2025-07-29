import { InteractionResponseType } from 'discord-interactions';
import { startWrap } from '../../src/sessions/wrap.js';

export async function wrap(guildId: string | undefined) {
  if (!guildId) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: '⚠️ This command must be used inside a server.',
        flags: 64,
      },
    };
  }

  startWrap(guildId);

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: '✅ Daily Spotify wrap tracking started for this server!' },
  };
}