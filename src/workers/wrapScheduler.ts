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
// the UTC clock-time when 21:00 UTC (9 PM) happens for that guild.
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

    const rows = Array.isArray(data) ? data.filter((r) => r.top_track !== null || r.top_artist !== null) : [];
    if (!rows.length) return;

        const userLines = rows.map((row) => {
      // Prefer a real username fallback in case mention fails to resolve (user left guild or mention suppression)
      const mention = `<@${row.user_id}>`;
      const displayName = row.username ? `@${row.username}` : mention;
      return `${displayName} — 🎵 **Track:** ${row.top_track ?? 'N/A'} | 🎤 **Artist:** ${row.top_artist ?? 'N/A'}`;
    });

        // Fetch a prompt based on number of users
    const summaryPrompt = await pickSummaryPrompt(userLines.length);

    // Build description: prompt on its own line, then blank, then list
    const finalLines = [summaryPrompt, '', ...userLines];

    // Choose accent colour based on crowd level
    const RED = 0xed4245;
    const YELLOW = 0xfaa61a;
    const GREEN = 0x57f287;
    let accent = GREEN;
    if (userLines.length <= 3) accent = RED;
    else if (userLines.length <= 8) accent = YELLOW;

        const payload = buildWrapPayload(finalLines, 0, 'Daily Wrap', rows.slice(0, 5), accent);

        const msgRes: any = await rest.post(Routes.channelMessages(channelId), {
      body: payload,
    });

    // Persist snapshot so pagination still works after daily reset
    try {
      await supabase.from('wrap_guilds').update({ posted: true, wrap_up: rows }).eq('guild_id', guildId);
    } catch (err) {
      console.error('[wrapScheduler] failed to set posted flag or wrap snapshot for', guildId, err);
    }

    // Schedule edit after 1 hour to disable numeric buttons
    setTimeout(async () => {
      try {
        // Clone components and disable num buttons (row index 1)
        if (!payload.components) return;
        const newComponents = payload.components.map((row: any, idx: number) => {
          if (idx !== 1) return row;
          return {
            ...row,
            components: row.components.map((c: any) => ({ ...c, disabled: true })),
          };
        });
        await rest.patch(Routes.channelMessage(channelId, msgRes.id), {
          body: { components: newComponents },
        });
        // After one hour, allow next day's wrap by resetting the posted flag
        await supabase.from('wrap_guilds').update({ posted: false }).eq('guild_id', guildId);
      } catch (err) {
        console.error('[wrapScheduler] failed to disable buttons for', msgRes.id, err);
      }
    }, 60 * 60 * 1000); // 1 hour

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
      // fetch local_time and posted flag so we can suppress duplicate posts within the leeway window
      const query = supabase.from('wrap_guilds').select('guild_id, local_time, posted');

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
                  const raw = (r.local_time as string | null | undefined) ?? '21:00';
                  const target = raw.slice(0, 5); // ignore seconds if present
                  const [hh, mm] = target.split(':').map(Number);
                  const targetMinutes = hh * 60 + mm;
                  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
                  let diff = Math.abs(nowMinutes - targetMinutes);
                  if (diff > 720) diff = 1440 - diff; // cross-midnight wrap-around
                  if (r.posted) return false; // skip if wrap already posted within leeway window
                  return diff <= 5; // within 5-minute window
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