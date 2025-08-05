import { InteractionResponseType } from 'discord-interactions';
import { startWrap, isWrapped } from '../../src/sessions/wrap.js';

const ADMIN_FLAG = 0x8n;

export async function wrap(interaction: any) {
  const guildId = interaction.guild_id as string | undefined;
  if (!guildId) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: '⚠️ This command must be used inside a server.',
        flags: 64,
      },
    };
  }

  // Ensure caller has Administrator permission
  const permStr: string | undefined = interaction.member?.permissions;
  const hasAdmin = permStr ? (BigInt(permStr) & ADMIN_FLAG) === ADMIN_FLAG : false;

  if (!hasAdmin) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: '🚫 Only server administrators can enable wrap tracking.',
        flags: 64,
      },
    };
  }

  // If wrap already enabled, inform the user and abort.
  if (isWrapped(guildId)) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: 'ℹ️ Daily Spotify wrap tracking is already active for this server.',
        flags: 64,
      },
    };
  }

  const ok = await startWrap(guildId);

  if (!ok) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: '❌ Failed to start wrap tracking. Please try again later.' },
    };
  }

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: '✅ Daily Spotify wrap tracking started for this server!' },
  };
}