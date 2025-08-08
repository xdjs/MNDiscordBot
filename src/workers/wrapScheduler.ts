import { Client, REST, Routes, TextChannel } from 'discord.js';
import { supabase } from '../../api/lib/supabase.js';
import { wrapGuilds } from '../sessions/wrap.js';
import { buildWrapPayload } from '../utils/wrapPaginator.js';

// History table to store per-user snapshots per post. Configurable via env for flexibility.
const HISTORY_TABLE = process.env.WRAP_HISTORY_TABLE || 'history';

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

  //selects a random prompt from the database (possibly move condition to db)
  if (count <= 3) return pickRandom(data.slow) ?? 'Daily Summary';
  if (count < 8) return pickRandom(data.moderate) ?? 'Daily Summary';
  return pickRandom(data.busy) ?? 'Daily Summary';
}

// -----------------------------------------------
// Shame title selector
// -----------------------------------------------
async function pickShameTitle(): Promise<string> {
  const { data, error } = await supabase
    .from('Summary_prompts')
    .select('shaming')
    .limit(1)
    .single();

  if (error || !data) return 'Did not listen today 😔';

  const arr = (data.shaming as string[]) ?? [];
  if (!Array.isArray(arr) || arr.length === 0) return 'Did not listen today 😔';
  return arr[Math.floor(Math.random() * arr.length)];
}

// -----------------------------------------------
// Random emoji selector for buttons
// -----------------------------------------------
async function pickRandomEmoji(): Promise<string> {
  try {
    const { data, error } = await supabase
      .from('Summary_prompts')
      .select('emoji')
      .limit(1)
      .single();

    if (error || !data) return '🔎'; // fallback to magnifying glass

    const emojis = (data.emoji as string[]) ?? [];
    if (!Array.isArray(emojis) || emojis.length === 0) return '🔎';

    return emojis[Math.floor(Math.random() * emojis.length)];
  } catch (err) {
    console.error('[pickRandomEmoji] failed to load emojis', err);
    return '🔎'; // fallback to magnifying glass
  }
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
    // Determine preferred channel id or name for this guild (DB override > env > default)
    let preferredName = 'wrap-up';
    let configuredChannelId: string | null = null;
    try {
      const { data } = await supabase
        .from('wrap_guilds')
        .select('channel')
        .eq('guild_id', guildId);
      if (Array.isArray(data) && data.length && data[0]?.channel) {
        // Accept raw ID, <#ID> mention, or a channel name
        const raw = String(data[0].channel).trim();
        const idCandidate = raw.replace(/[^0-9]/g, '');
        if (idCandidate.length >= 10) {
          configuredChannelId = idCandidate;
        } else {
          preferredName = raw.replace(/^#/, '');
        }
      }
    } catch (err) {
      console.error('[wrapScheduler] failed to fetch channel pref for', guildId, err);
    }
    // If DB had no value, fall back to env var (name)
    if (!configuredChannelId && !preferredName && process.env.WRAP_CHANNEL_NAME) preferredName = process.env.WRAP_CHANNEL_NAME;
    preferredName = preferredName.toLowerCase();
    let channelId: string | null = null;

    if (configuredChannelId) {
      let byId = guild.channels.cache.get(configuredChannelId) as TextChannel | undefined;
      if (!byId) {
        try {
          const fetched = await guild.channels.fetch(configuredChannelId);
          byId = (fetched ?? undefined) as TextChannel | undefined;
        } catch {}
      }
      if (byId && byId.isTextBased() && byId.viewable) channelId = byId.id;
    }
    if (!channelId) {
      const match = guild.channels.cache.find(
        (c) => c.isTextBased() && (c as TextChannel).name.toLowerCase() === preferredName,
      ) as TextChannel | undefined;
      if (match && match.viewable) channelId = match.id;
    }

    // Fallback to system channel, then first readable text channel
    if (!channelId) channelId = guild.systemChannelId ?? null;
    if (!channelId) {
      const firstText = guild.channels.cache.find((c) => c.isTextBased() && (c as TextChannel).viewable) as TextChannel | undefined;
      if (firstText) channelId = firstText.id;
    }
    if (!channelId) return; // Cannot post

    const { data } = await supabase
      .from('user_tracks')
      .select('user_id, username, top_track, top_artist, tracks, last_updated')
      .eq('guild_id', guildId);

    const rows = Array.isArray(data)
      ? data.filter((r) => r.top_track !== null || r.top_artist !== null)
        .map((r:any)=>{
          const first = Array.isArray(r.tracks) && r.tracks.length ? r.tracks[0] : null;
          const id = first ? (typeof first === 'string' ? first : first.id) : null;
          return { ...r, spotify_track_id: id };
        })
      : [];
    // Users with no listening data for the day – we'll "shame" them separately
    const shameRows = Array.isArray(data)
      ? data.filter((r) => r.top_track === null && r.top_artist === null)
      : [];
    if (!rows.length) return;

        // Build separate lists for artists and tracks
    const artistLines = rows.map((row) => {
      const mention = `<@${row.user_id}>`;
      return `${mention} — 🎤 **Artist:** ${row.top_artist ?? 'N/A'}`;
    });

    const trackLines = rows.map((row:any) => {
      const mention = `<@${row.user_id}>`;
      const url = row.spotify_track_id ? `https://open.spotify.com/track/${row.spotify_track_id}` : null;
      const display = url ? `[${row.top_track ?? 'N/A'}](${url})` : (row.top_track ?? 'N/A');
      return `${mention} — 🎵 **Track:** ${display}`;
    });

    // Fetch a prompt based on number of users
    const summaryPrompt = await pickSummaryPrompt(rows.length);

    // Build description arrays: prompt, blank line, then list
    const finalArtistLines = [summaryPrompt, '', ...artistLines];
    const finalTrackLines = [summaryPrompt, '', ...trackLines];

    // Choose accent colour based on crowd level
    const RED = 0xed4245;
    const YELLOW = 0xfaa61a;
    const GREEN = 0x57f287;
    let accent = GREEN;
    if (rows.length <= 3) accent = RED;
    else if (rows.length < 8) accent = YELLOW;

    const nowIso = new Date().toISOString();
    const today = nowIso.split('T')[0]; // YYYY-MM-DD
    const postedId = nowIso.replace(/[^0-9A-Z]/gi, ''); // safe custom_id fragment
    // Build payloads with unique postedId
    const artistPayload = buildWrapPayload(finalArtistLines, 0, 'Daily Top Artists', rows.slice(0, 5), accent, 'artist', postedId);
    // Append random emoji to artist button labels
    if (artistPayload.components) {
      for (const row of artistPayload.components) {
        if (row.components) {
          for (const c of row.components) {
            if (typeof c.label === 'string' && !c.label.includes('🔎')) {
              const randomEmoji = await pickRandomEmoji();
              c.label = `${c.label} ${randomEmoji}`;
            }
          }
        }
      }
    }
    const trackUserRows = rows.slice(0, 5).map((r) => ({ ...r, top_track: r.top_track, top_artist: r.top_artist }));
    const trackPayload = buildWrapPayload(finalTrackLines, 0, 'Daily Top Tracks', trackUserRows, accent, 'track', postedId);
    // Add random emojis to track button labels
    if (trackPayload.components) {
      for (const row of trackPayload.components) {
        if (row.components) {
          for (const c of row.components) {
            if (typeof c.label === 'string' && !c.label.includes('🔎')) {
              const randomEmoji = await pickRandomEmoji();
              c.label = `${c.label} ${randomEmoji}`;
            }
          }
        }
      }
    }

    // Post both embeds (results no longer needed)
    await rest.post(Routes.channelMessages(channelId), { body: artistPayload });
    await rest.post(Routes.channelMessages(channelId), { body: trackPayload });

    // Post shame list for users with no listening data
    if (shameRows.length) {
      const shameTitle = await pickShameTitle();
      const shameLines = shameRows.map((row) => {
        const mention = `<@${row.user_id}>`;
        const displayName = mention;
        return displayName;
      });
      const shamePayload = {
        embeds: [
          {
            title: shameTitle,
            description: shameLines.join('\n') || '—',
            color: 0x808080,
          },
        ],
      } as any;
      await rest.post(Routes.channelMessages(channelId), {
        body: shamePayload,
      });
    }

    const needsSnapshot = rows.length > 5; // only multi-page embeds need historical storage

    let artistData: any[] | undefined;
    let trackData: any[] | undefined;
    let historicalEntry: any | undefined;

    if (needsSnapshot) {
      // Persist snapshots so pagination still works after daily reset
      artistData = rows.map(row => ({
        user_id: row.user_id,
        top_artist: row.top_artist,
        username: row.username,
        last_updated: row.last_updated,
      }));

      trackData = rows.map(row => ({
        user_id: row.user_id,
        top_track: row.top_track,
        top_artist: row.top_artist,
        spotify_track_id: row.spotify_track_id,
        username: row.username,
        last_updated: row.last_updated,
      }));

      historicalEntry = {
        posted_at: nowIso,
        date: today,
        data: rows,
        shame: shameRows,
      };
    }

    // Persist per-user history rows only if arrow pagination is needed (multi-page results)
    if (needsSnapshot) {
      try {
        if (rows.length) {
          const historyRows = rows.map((row: any) => {
            const rawId = row.spotify_track_id;
            const trackId = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : null;
            return {
              guild_id: guildId,
              user_id: row.user_id,
              posted_at: nowIso,
              top_artist: row.top_artist,
              top_track: row.top_track,
              track_id: trackId,
            };
          });

          await supabase
            .from(HISTORY_TABLE)
            .upsert(historyRows as any, { onConflict: 'guild_id,user_id,posted_at' } as any);
        }
      } catch (err) {
        console.error('[wrapScheduler] failed to write history rows', guildId, err);
      }
    }

    try {
      // First, get existing wrap_up history
      const { data: existing } = await supabase
        .from('wrap_guilds')
        .select('wrap_up')
        .eq('guild_id', guildId)
        .maybeSingle();
      
      let historicalData = [];
      if (existing?.wrap_up && Array.isArray(existing.wrap_up)) {
        // If wrap_up already contains historical data, append to it
        historicalData = existing.wrap_up;
        // Remove any existing entry for today (in case of re-runs)
        historicalData = historicalData.filter((entry: any) => entry.date !== today);
      }
      
      if (historicalEntry) historicalData.push(historicalEntry);
      
      // Compute next local_time based on interval setting
      let nextLocalTime: string | undefined;
      try {
        const { data: cfg } = await supabase
          .from('wrap_guilds')
          .select('local_time, interval')
          .eq('guild_id', guildId)
          .maybeSingle();

        const intervalHours = typeof cfg?.interval === 'number' ? cfg.interval : 0;
        if (intervalHours && intervalHours > 0) {
          // Base time: existing local_time (if any) else current UTC time
          let baseH: number;
          let baseM: number;
          if (cfg?.local_time) {
            const [hStr, mStr] = cfg.local_time.slice(0, 5).split(':');
            baseH = parseInt(hStr, 10);
            baseM = parseInt(mStr, 10);
          } else {
            const nowUtc = new Date();
            baseH = nowUtc.getUTCHours();
            baseM = nowUtc.getUTCMinutes();
          }
          const newH = (baseH + intervalHours) % 24;
          const hh = newH.toString().padStart(2, '0');
          const mm = baseM.toString().padStart(2, '0');
          nextLocalTime = `${hh}:${mm}:00`;
        }
      } catch (err) {
        console.error('[wrapScheduler] failed to compute next local_time', guildId, err);
      }

      const updatePayload: any = {
        posted: true,
        wrap_up: needsSnapshot ? historicalData : undefined,
        wrap_artists: needsSnapshot ? artistData : undefined,
        wrap_tracks: needsSnapshot ? trackData : undefined,
        shame: shameRows,
      };
      if (nextLocalTime) {
        updatePayload.local_time = nextLocalTime;
      }

      await supabase
        .from('wrap_guilds')
        .update(updatePayload)
        .eq('guild_id', guildId);
    } catch (err) {
      console.error('[wrapScheduler] failed to set posted flag or wrap snapshot for', guildId, err);
    }

    // Schedule flag reset after 45 minutes so the next day's wrap can post,
    // but KEEP all artist bio buttons available indefinitely.
    setTimeout(async () => {
      try {
        await supabase.from('wrap_guilds').update({ posted: false }).eq('guild_id', guildId);
      } catch (err) {
        console.error('[wrapScheduler] failed to reset posted flag for', guildId, err);
      }
    }, 45 * 60 * 1000); // 45 minutes to match the interval set by the user

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


export function initWrapScheduler(client: Client, rest: REST) {
  console.log('[wrapScheduler] Initialising minute-ticker for wrap posts');

  setInterval(async () => {
    try {
      const now = new Date();
      

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