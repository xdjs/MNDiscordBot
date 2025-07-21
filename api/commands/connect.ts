import { InteractionResponseType } from 'discord-interactions';
import { supabase } from '../lib/supabase.js';
import { generateSpotifyAuthUrl } from '../lib/spotify.js';
import 'dotenv/config';

export async function connect(userId: string) {
  const { data } = await supabase
    .from('spotify_tokens')
    .select('access_token')
    .eq('user_id', userId)
    .maybeSingle();

  if (data) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: 'You have already connected your Spotify account ✅',
        flags: 64,
      },
    };
  }

  const authUrl = generateSpotifyAuthUrl(userId);

  // Attempt to DM the user with the link
  try {
    const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
    if (BOT_TOKEN) {
      // 1. Create DM channel
      const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bot ${BOT_TOKEN}` },
        body: JSON.stringify({ recipient_id: userId }),
      });
      const dmJson = await dmRes.json();

      // 2. Send message in DM channel
      if (dmRes.ok && dmJson.id) {
        await fetch(`https://discord.com/api/v10/channels/${dmJson.id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bot ${BOT_TOKEN}` },
          body: JSON.stringify({ content: `Click the link below to connect your Spotify account:\n${authUrl}` }),
        });
      } else {
        console.error('[connect] DM channel create failed', dmJson);
      }
    }
  } catch (err) {
    console.error('[connect] Failed to DM user', err);
  }

  // Ephemeral confirmation
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: '📬 I\'ve sent you a DM with a link to connect your Spotify account!',
      flags: 64,
    },
  };
} 