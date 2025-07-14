import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { createClient } from '@supabase/supabase-js';

/**
 * Render Background Worker: processes rows inserted by the `/listen` command.
 *
 * 1. Polls the `listen_triggers` table every N seconds.
 * 2. For each unprocessed trigger, posts a confirmation message in the target channel.
 * 3. Removes (or you could mark handled) the trigger row so it isn't processed twice.
 *
 * Extend this file later to fetch the user's current track and post fun facts, etc.
 */

// ---- Environment ----
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  DISCORD_BOT_TOKEN,
  POLL_INTERVAL_MS = '10000', // default 10 s
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required.');
}
if (!DISCORD_BOT_TOKEN) {
  throw new Error('DISCORD_BOT_TOKEN env var is required to post messages.');
}

// ---- Clients ----
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);

// ---- Worker Logic ----
async function processTriggers() {
  const { data: triggers, error } = await supabase
    .from('listen_triggers')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(100);

  if (error) {
    console.error('Supabase fetch error:', error);
    return;
  }
  if (!triggers || triggers.length === 0) return;

  for (const trigger of triggers) {
    try {
      await rest.post(Routes.channelMessages(trigger.channel_id), {
        body: {
          content: `👂 <@${trigger.user_id}> started a listening session!`,
        },
      });

      // Remove the trigger (idempotency)
      await supabase.from('listen_triggers').delete().eq('id', trigger.id);
    } catch (err) {
      console.error('Failed to process trigger', trigger.id, err);
    }
  }
}

console.log('🔊 Listen Worker started – polling for triggers...');

// Run immediately, then on an interval
processTriggers();
setInterval(processTriggers, parseInt(POLL_INTERVAL_MS, 10)); 