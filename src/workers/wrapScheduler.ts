import { Client, REST, Routes, TextChannel } from 'discord.js';
import { supabase } from '../../api/lib/supabase.js';
import { wrapGuilds } from '../sessions/wrap.js';
import { buildWrapPayload } from '../utils/wrapPaginator.js';

// -----------------------------------------------
// Summary prompt selector based on user count
// -----------------------------------------------
async function pickSummaryPrompt(count: number): Promise<string> {
  const { data, error } = await supabase
    .from('Summary_prompts')
    .select('slow, moderate, busy')
    .limit(1)
    .single();

  if (error || !data) return 'Daily Summary';

  const pickRandom = (arr: any): string | undefined => {
    if (!Array.isArray(arr) || arr.length === 0) return undefined;
    return arr[Math.floor(Math.random() * arr.length)];
  };

  if (count <= 3) return pickRandom(data.slow) ?? 'Daily Summary';
  if (count <= 8) return pickRandom(data.moderate) ?? 'Daily Summary';
  return pickRandom(data.busy) ?? 'Daily Summary';
}


// ------------------------------------------------------------------------------------------------
// Dynamic wrap-up scheduler:
// Every minute, determine which guilds are due for their daily post based on the UTC time stored
// in user_tracks.local_time (set via /settime). The stored value is a string "HH:MM" representing
// the UTC clock-time when 23:50 local happens for that guild.
// ------------------------------------------------------------------------------------------------

async function postWrapForGuild(guildId: string, client: Client, rest: REST) {
  try {
    const guild = await client.guilds.fetch(guildId);
    // Preferred channel by name via env var
    const preferredName = (process.env.WRAP_CHANNEL_NAME ?? 'wrap-up').toLowerCase();
    let channelId: string | null = null;

    const match = guild.channels.cache.find(
      (c) => c.isTextBased() && (c as TextChannel).name.toLowerCase() === preferredName,
    ) as TextChannel | undefined;

    if (match && match.viewable) channelId = match.id;

    // Fallback to system channel, then first readable text channel
    if (!channelId) channelId = guild.systemChannelId ?? null;
    if (!channelId) {
      const firstText = guild.channels.cache.find((c) => c.isTextBased() && (c as TextChannel).viewable) as TextChannel | undefined;
      if (firstText) channelId = firstText.id;
    }
    if (!channelId) return; // Cannot post

    const startOfDay = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));

    const { data } = await supabase
      .from('user_tracks')
      .select('user_id, username, top_track, top_artist, last_updated')
      .eq('guild_id', guildId);

    if (!Array.isArray(data) || !data.length) return;

        const userLines = data.map((row) => {
      const userMention = `<@${row.user_id}>`;
      return `${userMention} — 🎵 **Track:** ${row.top_track ?? 'N/A'} | 🎤 **Artist:** ${row.top_artist ?? 'N/A'}`;
    });

        // Fetch a prompt based on number of users
    const summaryPrompt = await pickSummaryPrompt(userLines.length);

    // Build description: prompt on its own line, then blank, then list
    const finalLines = [summaryPrompt, '', ...userLines];

    const payload = buildWrapPayload(finalLines, 0, 'Daily Wrap');

    const msgRes: any = await rest.post(Routes.channelMessages(channelId), {
      body: payload,
    });
  } catch (err) {
    console.error('[wrapScheduler] failed to post wrap for guild', guildId, err);
  }
}

async function resetDailyForGuild(guildId: string) {
  try {
    await supabase
      .from('user_tracks')
      .update({ tracks: [], artists: [], top_track: null, top_artist: null })
      .eq('guild_id', guildId);
  } catch (err) {
    console.error('[wrapScheduler] failed to reset daily data for guild', guildId, err);
  }
}

async function runDailyWrap(client: Client, rest: REST) {
  console.log('[wrapScheduler] Running daily wrap job');
  for (const gid of wrapGuilds) {
    await postWrapForGuild(gid, client, rest);
    await resetDailyForGuild(gid);
  }
}

export function initWrapScheduler(client: Client, rest: REST) {
  console.log('[wrapScheduler] Initialising minute-ticker for wrap posts');

  setInterval(async () => {
    try {
      const now = new Date();
      const timeStr = `${now.getUTCHours().toString().padStart(2, '0')}:${now.getUTCMinutes()
        .toString()
        .padStart(2, '0')}`;

      // Fetch guilds whose configured posting time matches current UTC minute
      const query = supabase.from('wrap_guilds').select('guild_id, local_time');

      const { data, error } = await query;

      if (error) {
        console.error('[wrapScheduler] Supabase query error', error);
        return;
      }

      // Determine which guilds should post at this minute
      const guildIds = Array.isArray(data)
        ? [
            ...new Set(
              data
                .filter((r: any) => {
                  const t = r.local_time as string | null | undefined;
                  return (t ?? '23:50') === timeStr; // default to 23:50 UTC if not set
                })
                .map((r: any) => r.guild_id)
                .filter(Boolean),
            ),
          ]
        : [];

      for (const gid of guildIds) {
        if (!wrapGuilds.has(gid)) continue; // Only post for guilds that have wrap tracking enabled
        await postWrapForGuild(gid, client, rest);
        await resetDailyForGuild(gid);
      }
    } catch (err) {
      console.error('[wrapScheduler] tick error', err);
    }
  }, 60 * 1000); // every minute
}