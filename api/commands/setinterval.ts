import { InteractionResponseType } from 'discord-interactions';
import { supabase } from '../lib/supabase.js';

/**
 * /setinterval command – configure how many hours apart additional wrap-up posts should be.
 * The command accepts an integer 1-6.  Values >6 (or invalid) are treated as 0 which means
 * once-per-day posting based on local_time just like today.
 *
 * The value is persisted to wrap_guilds.interval (numeric).
 */
export async function setinterval(interaction: any) {
  const guildId = interaction.guild_id as string | undefined;
  if (!guildId) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: '⚠️ This command must be used inside a server.', flags: 64 },
    };
  }

  // Only allow server Administrators to change scheduling
  const ADMIN_FLAG = 0x8n;
  const permStr: string | undefined = interaction.member?.permissions;
  const hasAdmin = permStr ? (BigInt(permStr) & ADMIN_FLAG) === ADMIN_FLAG : false;
  if (!hasAdmin) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: '🚫 Only server administrators can configure the wrap interval.',
        flags: 64,
      },
    };
  }

  // Expect an integer option called "hours"
  const option = Array.isArray(interaction.data?.options) && interaction.data.options.length
    ? (interaction.data.options[0] as any)
    : null;
  const valueRaw = option?.value;
  const hours = typeof valueRaw === 'number' ? valueRaw : parseInt(String(valueRaw), 10);
  if (isNaN(hours)) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: 'Please provide a whole number of hours (1-6).', flags: 64 },
    };
  }

  // Clamp and interpret
  const interval = hours >= 1 && hours <= 6 ? hours : 0; // 0 = daily mode

  try {
    await supabase.from('wrap_guilds').upsert({
      guild_id: guildId,
      interval,
      // keep existing local_time/started_at untouched – upsert will merge on PK (guild_id)
    });
  } catch (err) {
    console.error('[setinterval] DB error', err);
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: 'Failed to save the interval. Please try again later.', flags: 64 },
    };
  }

  const msg = interval > 0
    ? `✅ Got it! I'll post additional wraps every **${interval} hour${interval === 1 ? '' : 's'}**.`
    : '✅ Interval removed – wraps will post once per day at the configured local time.';

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: msg, flags: 64 },
  };
}
