import { InteractionResponseType } from 'discord-interactions';
import { supabase } from '../lib/supabase.js';

/**
 * /setchannel command – configure which text channel the daily wrap-up embeds
 * should be posted in.  The value stored is the text channel's name (case–insensitive).
 *
 * The selected name is persisted to wrap_guilds.channel (text).
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

  // Expect a string option called "name"
  const option = Array.isArray(interaction.data?.options) && interaction.data.options.length
    ? (interaction.data.options[0] as any)
    : null;
  const valueRaw = option?.value;
  const channelName = typeof valueRaw === 'string' ? valueRaw.trim() : '';

  if (!channelName) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: 'Please provide the name of an existing text channel.', flags: 64 },
    };
  }

  try {
    await supabase.from('wrap_guilds').upsert({
      guild_id: guildId,
      channel: channelName,
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
    data: { content: `✅ Wrap-up posts will now target **#${channelName}**.`, flags: 64 },
  };
}
