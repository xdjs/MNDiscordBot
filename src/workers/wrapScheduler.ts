import { Client, REST, Routes, TextChannel } from 'discord.js';
import { supabase } from '../../api/lib/supabase.js';
import { wrapGuilds } from '../sessions/wrap.js';
import { buildWrapPayload } from '../utils/wrapPaginator.js';

// Time (UTC) to post daily summary
const TARGET_HOUR = 11;
const TARGET_MINUTE = 50;

function msUntilNextTarget(): number {
  const now = new Date();
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), TARGET_HOUR, TARGET_MINUTE, 0, 0));
  if (now > target) {
    // Already past today's target, schedule for tomorrow
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target.getTime() - now.getTime();
}

async function postWrapForGuild(guildId: string, client: Client, rest: REST) {
  try {
    const guild = await client.guilds.fetch(guildId);
    // Attempt to use system channel, fallback to first text channel
    let channelId = guild.systemChannelId ?? null;
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

    const lines = data.map((row) => {
      const userMention = `<@${row.user_id}>`;
      return `${userMention} — 🎵 **Track:** ${row.top_track ?? 'N/A'} | 🎤 **Artist:** ${row.top_artist ?? 'N/A'}`;
    });

    const payload = buildWrapPayload(lines, 0, 'Daily Spotify Wrap');

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
  async function schedule() {
    const delay = msUntilNextTarget();
    console.log(`[wrapScheduler] Scheduling next daily wrap in ${delay / 1000 / 60} minutes`);
    setTimeout(async () => {
      await runDailyWrap(client, rest);
      schedule(); // Schedule next run
    }, delay);
  }
  schedule();
}