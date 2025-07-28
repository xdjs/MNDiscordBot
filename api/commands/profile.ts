import { InteractionResponseType } from 'discord-interactions';
import { supabase } from '../lib/supabase.js';
// later will import queue

/**
 * Generates a profile card image and sends it as a follow-up message.
 * Returns a deferred response so the initial slash command is acknowledged within 3 seconds.
 */
export async function profile(interaction: any) {
  const userObj = interaction.member?.user ?? interaction.user;
  const userId = userObj.id;

  // Check if a cached profile card exists
  try {
    const { data: existing } = await supabase
      .from('profiles')
      .select('card_url')
      .eq('user_id', userId)
      .maybeSingle();

    if (existing?.card_url) {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { embeds: [{ image: { url: existing.card_url } }] },
      };
    }
  } catch (err) {
    console.error('[profile] cache lookup error', err);
  }

  // No cached card – inform user and queue generation
  const immediateResponse = {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: '🖼️ Generating your profile card… this may take a minute.',
      flags: 64, // ephemeral so only the user sees it
    },
  };

  try {
    const { enqueueProfileJob } = await import('../../src/workers/queue.js');
    enqueueProfileJob({
      user_id: userObj.id,
      username: userObj.username,
      avatar: userObj.avatar,
      application_id: interaction.application_id,
      interaction_token: interaction.token,
    });
  } catch (err) {
    console.error('[profile] Failed to enqueue profile job', err);
  }

  return immediateResponse;
} 