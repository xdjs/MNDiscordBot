import { InteractionResponseType } from 'discord-interactions';
import { stopWrap } from '../../src/sessions/wrap.js';

/** Bit flag for the Administrator permission in Discord */
const ADMIN_FLAG = 0x8n;

export async function unwrap(interaction: any) {
  const guildId = interaction.guild_id as string | undefined;
  if (!guildId) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: '⚠️ This command must be used inside a server.', flags: 64 },
    };
  }

  // Ensure caller has Administrator permission
  const permStr: string | undefined = interaction.member?.permissions;
  const hasAdmin = permStr ? (BigInt(permStr) & ADMIN_FLAG) === ADMIN_FLAG : false;

  if (!hasAdmin) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: '🚫 Only server administrators can disable wrap tracking.',
        flags: 64,
      },
    };
  }

  await stopWrap(guildId);

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: '🛑 Wrap tracking disabled for this server.' },
  };
} 