import { InteractionResponseType } from 'discord-interactions';
import { supabase } from '../lib/supabase.js';

/**
 * /settime command – allows a user to specify their local time (HH:MM 24-hour)
 * The bot stores this time string in the `local_time` column of the `wrap_guilds` table.
 * Later, the wrap-up scheduler reads that column to figure out when to post a summary in the guild.
 */
export async function settime(interaction: any) {
  const userObj = interaction.member?.user ?? interaction.user;
  const userId = userObj.id as string;
  const guildId = interaction.guild_id as string | undefined;

  // Expect an option called "time" with format HH:MM
  const timeOption = Array.isArray(interaction.data?.options) && interaction.data.options.length
    ? (interaction.data.options[0] as any)
    : null;

  const timeValue: string | undefined = timeOption?.value;

  // Basic validation: HH:MM in 24-hour (00-23):(00-59)
  const timeRegex = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!timeValue || typeof timeValue !== 'string' || !timeRegex.test(timeValue)) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: 'Please provide a valid local time in the format **HH:MM** (24-hour). Example: `14:30`',
        flags: 64,
      },
    };
  }

  // Parse user-provided current local time
  const [locHStr, locMStr] = timeValue.split(':');
  const locH = parseInt(locHStr, 10);
  const locM = parseInt(locMStr, 10);

  const nowUtc = new Date();
  const utcH = nowUtc.getUTCHours();
  const utcM = nowUtc.getUTCMinutes();

  // Offset in minutes from UTC to the user's local time (local = UTC + offset)
  let offsetMin = (locH - utcH) * 60 + (locM - utcM);
  // Normalise to -720..+720 range
  if (offsetMin < -720) offsetMin += 1440;
  if (offsetMin > 720) offsetMin -= 1440;

  // Desired local posting time is 23:50 (11:50 PM local)
  const localPostMin = 23 * 60 + 50;
  // Corresponding UTC minute-of-day when we should post
  let utcPostMin = localPostMin - offsetMin;
  utcPostMin = ((utcPostMin % 1440) + 1440) % 1440; // wrap into 0-1439

  const postH = Math.floor(utcPostMin / 60)
    .toString()
    .padStart(2, '0');
  const postM = (utcPostMin % 60).toString().padStart(2, '0');
  const utcPostStr = `${postH}:${postM}`;

  // Some databases expect the SQL TIME type to include seconds – include :00 for clarity
  const utcPostSqlTime = `${postH}:${postM}:00`;

  if (!guildId) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: 'This command must be used inside a server (guild) so I can schedule that guild\'s wrap-up.',
        flags: 64,
      },
    };
  }

  try {
    // Upsert into wrap_guilds so the scheduler has per-guild timing information
    await supabase.from('wrap_guilds').upsert(
      {
        guild_id: guildId,
        local_time: utcPostSqlTime,
        started_at: new Date().toISOString(),
      }
    );
  } catch (err) {
    console.error('[settime] DB error', err);
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: 'Failed to save your local time. Please try again later.', flags: 64 },
    };
  }

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: `✅ Got it! I'll post the daily wrap at 23:50 your time (which is ${utcPostStr} UTC).`,
      flags: 64,
    },
  };
} 