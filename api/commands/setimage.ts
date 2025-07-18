import { InteractionResponseType } from 'discord-interactions';
import { supabase } from '../lib/supabase.js';

/**
 * Sets the user's generated top-tracks image as their profile card background.
 * Requires that the user has already used /image at least once.
 */
export async function setimage(userId: string) {
  // 1. Look for cached image URL
  const { data: imgRow, error: imgErr } = await supabase
    .from('track_images')
    .select('image_url')
    .eq('user_id', userId)
    .maybeSingle();

  if (imgErr || !imgRow?.image_url) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "You don't have a generated image yet. Use /image first!",
        flags: 64,
      },
    };
  }

  // 2. Update profiles row with background_url
  try {
    await supabase.from('profiles').upsert({
      user_id: userId,
      bg_image_url: imgRow.image_url,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[setimage] DB error', err);
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: 'Failed to update profile background. Please try again later.',
        flags: 64,
      },
    };
  }

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: '✅ Profile background updated! Run /profile to see your new card.',
    },
  };
} 