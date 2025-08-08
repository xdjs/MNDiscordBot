import { InteractionResponseType } from 'discord-interactions';
import { supabase } from '../lib/supabase.js';

/**
 * /setchannel command – configure which text channel the daily wrap-up embeds
 * should be posted in. Accepts a Discord channel picker so we get the channel ID directly.
 *
 * The selected ID is persisted to wrap_guilds.channel (numeric / bigint).
 */
export async function setchannel(interaction: any) {
  const guildId = interaction.guild_id as string | undefined;
  if (!guildId) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: '⚠️ This command must be used inside a server.', flags: 64 },
    };
  }

  // Only allow server Administrators to change the channel
  const ADMIN_FLAG = 0x8n;
  const permStr: string | undefined = interaction.member?.permissions;
  const hasAdmin = permStr ? (BigInt(permStr) & ADMIN_FLAG) === ADMIN_FLAG : false;
  if (!hasAdmin) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: '🚫 Only server administrators can configure the wrap channel.',
        flags: 64,
      },
    };
  }

  // Expect a CHANNEL option named "channel"; Discord provides its ID as value
  const option = Array.isArray(interaction.data?.options) && interaction.data.options.length
    ? (interaction.data.options[0] as any)
    : null;
  const channelId = option?.value as string | undefined;
  if (!channelId) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: 'Please pick a text channel from the selector.', flags: 64 },
    };
  }

  try {
    await supabase.from('wrap_guilds').upsert({
      guild_id: guildId,
      channel: channelId,
    });
  } catch (err) {
    console.error('[setchannel] DB error', err);
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: 'Failed to save the channel. Please try again later.', flags: 64 },
    };
  }

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: `✅ Wrap-up posts will now target <#${channelId}>.`, flags: 64 },
  };
}
