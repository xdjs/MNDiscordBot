import { InteractionResponseType } from 'discord-interactions';
import { supabase } from '../lib/supabase.js';

const LISTEN_HOOK_URL = process.env.LISTEN_HOOK_URL;

export async function listen(userId: string, channelId: string, guildId: string | undefined) {
  await supabase.from('listen_triggers').insert({
    user_id: userId,
    channel_id: channelId,
    guild_id: guildId,
    created_at: new Date().toISOString(),
  });

  if (LISTEN_HOOK_URL) {
    try {
      await fetch(LISTEN_HOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, channel_id: channelId, guild_id: guildId }),
      });
    } catch (err) {
      console.error('Failed to hit listen webhook', err);
    }
  }

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: "🎧 Listening session started! I'll keep track of your current song." },
  };
} 