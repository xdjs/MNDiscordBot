import { supabase } from '../../api/lib/supabase.js';
import { Client } from 'discord.js';
import { Client as PgClient } from 'pg';

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

//stops the wrap tracking for the guild (unwrap)
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
  const pgUrl = process.env.SUPABASE_PG_URL || process.env.SUPABASE_ALT_URL;
  if (!pgUrl) {
    console.warn('[wrap] realtime disabled: no Postgres URL available for LISTEN/NOTIFY');
    return;
  }
  try {
    const pg = new PgClient({ connectionString: pgUrl, ssl: { rejectUnauthorized: false } });
    pg.connect().then(async () => {
      try {
        await pg.query('LISTEN wrap_guilds_changed');
        console.log('[wrap] Listening on channel wrap_guilds_changed');
      } catch (err) {
        console.error('[wrap] Failed to LISTEN wrap_guilds_changed', err);
      }
    }).catch((err) => console.error('[wrap] PG connect error', err));

    pg.on('notification', async (msg) => {
      if (msg.channel !== 'wrap_guilds_changed') return;
      try {
        const payload = msg.payload ? JSON.parse(msg.payload) : {};
        const event = String(payload.event || '').toUpperCase();
        const gid: string | undefined = payload.guild_id || payload.old_guild_id;
        if (!gid) return;
        if (event === 'INSERT') {
          wrapGuilds.add(gid);
          console.log(`[wrap] Realtime (PG): guild ${gid} added (tracking on)`);
          try {
            const guild = await client.guilds.fetch(gid);
            await guild.members.fetch({ withPresences: true });
          } catch {}
        } else if (event === 'DELETE') {
          wrapGuilds.delete(gid);
          console.log(`[wrap] Realtime (PG): guild ${gid} removed (tracking off)`);
        }
      } catch (err) {
        console.error('[wrap] notification parse error', err);
      }
    });

    pg.on('error', (err) => {
      console.error('[wrap] PG realtime error', err);
    });
  } catch (err) {
    console.error('[wrap] realtime subscription failed', err);
  }
}