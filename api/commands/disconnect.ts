import { InteractionResponseType } from 'discord-interactions';
import { supabase } from '../lib/supabase.js';

export async function disconnect(userId: string) {
  try {
    const { data } = await supabase
      .from('spotify_tokens')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (!data) {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: "You haven't connected your Spotify account yet. Use /connect first!",
          flags: 64,
        },
      };
    }

    const { error } = await supabase.from('spotify_tokens').delete().eq('user_id', userId);

    if (error) {
      console.error('[disconnect] DB delete error', error);
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: 'Sorry, something went wrong while disconnecting your account.',
          flags: 64,
        },
      };
    }

    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: '🗑️ Your Spotify account has been disconnected.',
        flags: 64,
      },
    };
  } catch (err) {
    console.error('[disconnect] Unexpected error', err);
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: 'Sorry, something went wrong.',
        flags: 64,
      },
    };
  }
} 