import { supabase } from '../../api/lib/supabase.js';
import { Client } from 'discord.js';

export const wrapGuilds = new Set<string>();


//loads the guilds that are wrapped from the database
export async function loadWrapGuilds() {
  try {
    const { data } = await supabase.from('wrap_guilds').select('guild_id');
    if (Array.isArray(data)) data.forEach((r) => wrapGuilds.add(r.guild_id));
  } catch (err) {
    console.error('[wrap] failed to load guild list', err);
  }
}

//adds the guild to the database for wrapped and starts listening for spotify activity
export async function startWrap(guildId: string): Promise<boolean> {
  wrapGuilds.add(guildId);
  try {
    const { error } = await supabase
      .from('wrap_guilds')
      .upsert({ guild_id: guildId, started_at: new Date().toISOString() });
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

//checks the status of the guild in the database
export function isWrapped(guildId: string): boolean {
  return wrapGuilds.has(guildId);
}

//initializes the realtime subscription for the wrap guilds
export function subscribeWrapGuilds(client: Client) {
  try {
    supabase
      .channel('wrap_guilds_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wrap_guilds' }, async (payload) => {
        const row: any = payload.new ?? payload.old ?? {};
        const guild_id = row.guild_id as string | undefined;
        if (!guild_id) return;
        if (payload.eventType === 'INSERT') {
          wrapGuilds.add(guild_id);
          console.log(`[wrap] Realtime: guild ${guild_id} added (tracking on)`);
          // Prefetch members to ensure presence updates arrive
          try {
            const guild = await client.guilds.fetch(guild_id);
            await guild.members.fetch({ withPresences: true });
            console.log('[wrap] Prefetched members for guild', guild_id);
          } catch (err) {
            console.error('[wrap] Failed to prefetch members for guild', guild_id, err);
          }
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