import { InteractionResponseType } from 'discord-interactions';
import { supabase } from '../lib/supabase.js';

const LISTEN_HOOK_URL = process.env.LISTEN_HOOK_URL;

export async function listen(userId: string, channelId: string, guildId: string | undefined) {
  // First ask Render to validate Spotify presence and (eventually) send a fun fact
  let hookStatus: string | null = null;

  if (LISTEN_HOOK_URL) {
    try {
      const res = await fetch(LISTEN_HOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, channel_id: channelId, guild_id: guildId }),
      });

      if (res.ok) {
        const json = (await res.json()) as { status?: string };
        hookStatus = json.status ?? null;
      }
    } catch (err) {
      console.error('Failed to hit listen webhook', err);
    }
  }

  // Always log a trigger row (optional analytics)
  await supabase.from('listen_triggers').insert({
    user_id: userId,
    channel_id: channelId,
    guild_id: guildId,
    created_at: new Date().toISOString(),
  });

  let reply: string;
  if (hookStatus === 'no-spotify') {
    reply = '⚠️ You are not currently listening to Spotify **or** “Display current activity” is disabled. Please start a song and enable the setting, then try /listen again.';
  } else {
    reply = "🎧 Listening session started! I'll send you a fun fact soon.";
  }

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: reply },
  };
} 