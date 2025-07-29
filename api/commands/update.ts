import { InteractionResponseType } from 'discord-interactions';
import { supabase } from '../lib/supabase.js';
import { buildWrapPayload } from '../../src/utils/wrapPaginator.js';

export async function update(guildId: string | undefined) {
  if (!guildId) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: '⚠️ This command must be used inside a server.', flags: 64 },
    };
  }

  const { data, error } = await supabase
    .from('user_tracks')
    .select('user_id, top_track, top_artist')
    .eq('guild_id', guildId);

  if (error) {
    console.error('[update cmd] supabase error', error);
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: '❌ Failed to fetch standings. Try again later.' },
    };
  }

  if (!data || !data.length) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: '📊 No wrap data recorded yet for today.' },
    };
  }

  const lines = data.map((row) => {
    const userMention = `<@${row.user_id}>`;
    return `${userMention} — 🎵 **Track:** ${row.top_track ?? 'N/A'} | 🎤 **Artist:** ${row.top_artist ?? 'N/A'}`;
  });

  const payload = buildWrapPayload(lines, 0, 'Current Spotify Wrap Standings');

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      ...payload,
    },
  };
}