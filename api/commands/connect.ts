import { InteractionResponseType } from 'discord-interactions';
import { supabase } from '../lib/supabase.js';
import { generateSpotifyAuthUrl } from '../lib/spotify.js';

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

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: `Click the link below to connect your Spotify account:\n${authUrl}`,
      flags: 64,
    },
  };
} 