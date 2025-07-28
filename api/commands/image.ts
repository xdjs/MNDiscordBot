import { InteractionResponseType } from 'discord-interactions';
import 'dotenv/config';
import { supabase } from '../lib/supabase.js';

/**
 * Queues an image-generation job on Render and immediately returns a deferred response.
 * The heavy lifting happens in the Render service (see /image-hook).
 */
export async function image(interaction: any) {
  const userObj = interaction.member?.user ?? interaction.user;
  const userId = userObj.id;

  // 1. Check for cached image – we'll still queue regeneration later, but show it instantly if present
  let immediateResponse: any = null;
  try {
    const { data: existing } = await supabase
      .from('track_images')
      .select('image_url')
      .eq('user_id', userId)
      .maybeSingle();

    if (existing?.image_url) {
      immediateResponse = {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { embeds: [{ image: { url: existing.image_url } }] },
      };
    }
  } catch (cacheErr) {
    console.error('[image] cache lookup error', cacheErr);
  }

  // Fallback message when no cached image yet
  if (!immediateResponse) {
    immediateResponse = {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: '🎨 Generating your personalized image… this may take a minute.',
        flags: 64, // ephemeral so only the user sees it
      },
    };
  }

  // 3. If we already had a cached image we can stop here – avoid duplicate follow-up.
  if (immediateResponse.data?.embeds) {
    return immediateResponse;
  }

  // 4. Otherwise enqueue a background job inside the same Fly app
  try {
    const { enqueueImageJob } = await import('../../src/workers/queue.js');
    enqueueImageJob({
      user_id: userObj.id,
      application_id: interaction.application_id,
      interaction_token: interaction.token,
    });
  } catch (err) {
    console.error('[image] Failed to enqueue image job', err);
  }

  return immediateResponse;
} 