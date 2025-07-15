import { InteractionResponseType } from 'discord-interactions';
import { supabase } from '../lib/supabase.js';
import { spotifyClientId, spotifyClientSecret } from '../lib/spotify.js';

async function fetchTopTracks(token: string) {
  return fetch(
    'https://api.spotify.com/v1/me/top/tracks?limit=10&time_range=medium_term',
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

async function refreshSpotifyToken(refreshToken: string) {
  const params = new URLSearchParams();
  params.append('grant_type', 'refresh_token');
  params.append('refresh_token', refreshToken);

  const basic = Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!res.ok) throw new Error('Failed to refresh');
  return res.json();
}

export async function tracks(userId: string) {
  const { data, error } = await supabase
    .from('spotify_tokens')
    .select('access_token, refresh_token')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "You haven't connected your Spotify account yet. Use /connect first!",
        flags: 64,
      },
    };
  }

  let { access_token: accessToken, refresh_token: refreshToken } = data as any;
  let res = await fetchTopTracks(accessToken);

  if (res.status === 401 && refreshToken) {
    try {
      const refreshed = await refreshSpotifyToken(refreshToken);
      accessToken = refreshed.access_token;
      await supabase
        .from('spotify_tokens')
        .update({ access_token: accessToken, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
      res = await fetchTopTracks(accessToken);
    } catch {
      /* ignore */
    }
  }

  if (!res.ok) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: 'Failed to fetch your top tracks. Please try again later.', flags: 64 },
    };
  }

  const json = await res.json();
  const tracksList = json.items
    .map((t: any, i: number) => `${i + 1}. ${t.name} – ${t.artists.map((a: any) => a.name).join(', ')}`)
    .join('\n');

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: `🎵 **<@${userId}>'s Top 10 Tracks:**\n${tracksList}` },
  };
} 