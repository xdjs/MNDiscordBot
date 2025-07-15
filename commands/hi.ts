import { InteractionResponseType } from 'discord-interactions';

export async function hi() {
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: 'Hi! 👋' },
  };
} 