import { InteractionResponseType } from 'discord-interactions';
import { supabase } from '../lib/supabase.js';

const LISTEN_HOOK_URL = process.env.LISTEN_HOOK_URL;
const MUSIC_HOOK_URL = process.env.MUSIC_HOOK_URL;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!;

export async function listen(userId: string, channelId: string, guildId: string | undefined) {
  try {
    // 1. Fetch the user object to see if the target is a bot account
    const usrRes = await fetch(`https://discord.com/api/v10/users/${userId}`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` },
    });

    if (usrRes.ok) {
      const userJson = (await usrRes.json()) as { bot?: boolean; username: string };

      if (userJson.bot) {
        // ---- Music bot flow ----
        if (MUSIC_HOOK_URL) {
          try {
            await fetch(MUSIC_HOOK_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ channel_id: channelId, bot_id: userId }),
            });
          } catch (err) {
            console.error('Failed to hit music hook', err);
          }

          return {
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `🎶 I'll listen for now-playing messages from <@${userId}>!`,
            },
          };
        }

        // MUSIC_HOOK_URL not configured
        return {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: '⚠️ Music listening feature is not configured.' },
        };
      }
    }
  } catch (err) {
    console.error('listen command: user lookup failed', err);
    // fall through to normal user flow
  }

  // ---- Spotify user flow ----
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

  // Analytics row (optional)
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
    reply = "🎧 Listening session started! I'll send you some fun facts.";
  }

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: reply },
  };
} 