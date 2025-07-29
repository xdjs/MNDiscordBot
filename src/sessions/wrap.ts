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

export function startWrap(guildId: string) {
  wrapGuilds.add(guildId);
  void supabase
    .from('wrap_guilds')
    .upsert({ guild_id: guildId })
    .throwOnError();
}

export function stopWrap(guildId: string) {
  wrapGuilds.delete(guildId);
  void supabase.from('wrap_guilds').delete().eq('guild_id', guildId).throwOnError();
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
        if (payload.eventType === 'INSERT') wrapGuilds.add(guild_id);
        if (payload.eventType === 'DELETE') wrapGuilds.delete(guild_id);
      })
      .subscribe();
  } catch (err) {
    console.error('[wrap] realtime subscription failed', err);
  }
}