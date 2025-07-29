import { supabase } from '../../api/lib/supabase.js';

export const wrapGuilds = new Set<string>();

export async function loadWrapGuilds() {
  try {
    const { data } = await supabase.from('wrap_guilds').select('guild_id');
    if (Array.isArray(data)) data.forEach((r) => wrapGuilds.add(r.guild_id));
  } catch (err) {
    console.error('[wrap] failed to load guild list', err);
  }
}

export async function startWrap(guildId: string): Promise<boolean> {
  wrapGuilds.add(guildId);
  try {
    const { error } = await supabase.from('wrap_guilds').upsert({ guild_id: guildId });
    if (error) {
      console.error('[wrap] upsert guild failed', error);
      return false;
    }
    console.log(`[wrap] Enabled wrap tracking for guild ${guildId}`);
    return true;
  } catch (err) {
    console.error('[wrap] upsert exception', err);
    return false;
  }
}

export async function stopWrap(guildId: string): Promise<void> {
  wrapGuilds.delete(guildId);
  await supabase.from('wrap_guilds').delete().eq('guild_id', guildId);
}

export function isWrapped(guildId: string): boolean {
  return wrapGuilds.has(guildId);
}

export function subscribeWrapGuilds() {
  try {
    supabase
      .channel('wrap_guilds_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wrap_guilds' }, (payload) => {
        const row: any = payload.new ?? payload.old ?? {};
        const guild_id = row.guild_id as string | undefined;
        if (!guild_id) return;
        if (payload.eventType === 'INSERT') {
          wrapGuilds.add(guild_id);
          console.log(`[wrap] Realtime: guild ${guild_id} added (tracking on)`);
        }
        if (payload.eventType === 'DELETE') {
          wrapGuilds.delete(guild_id);
          console.log(`[wrap] Realtime: guild ${guild_id} removed (tracking off)`);
        }
      })
      .subscribe();
  } catch (err) {
    console.error('[wrap] realtime subscription failed', err);
  }
}