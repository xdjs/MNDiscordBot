import { InteractionResponseType } from 'discord-interactions';
import { supabase } from '../lib/supabase.js';

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

  // Build two separate embed payloads — one for tracks, one for artists.
  const trackLines: string[] = [];
  const artistLines: string[] = [];

  // Simple ranking by order (could sort by something later)
  data.forEach((row, idx) => {
    const mention = `<@${row.user_id}>`;
    trackLines.push(`${mention} — 🎵 **Track:** ${row.top_track ?? 'N/A'} by ${row.top_artist ?? 'Unknown'}`);
    artistLines.push(`${idx + 1}. ${mention} — ${row.top_artist ?? 'N/A'}`);
  });

  const embeds = [
    {
      title: 'Top Tracks Today',
      description: trackLines.join('\n'),
      color: 0x2f3136,
    },
    {
      title: 'Top Artists Today',
      description: artistLines.join('\n'),
      color: 0x2f3136,
    },
  ];

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { embeds },
  };
}
