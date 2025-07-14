import { VercelRequest, VercelResponse } from '@vercel/node';
import {
  verifyKey,
  InteractionType,
  InteractionResponseType,
} from 'discord-interactions';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// ---- Environment & clients ----
const publicKey = process.env.DISCORD_PUBLIC_KEY!; // From Discord developer portal
const botToken = process.env.DISCORD_BOT_TOKEN!; // Needed for follow-up DMs (optional)
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const spotifyClientId = process.env.SPOTIFY_CLIENT_ID!;
const spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET!;
const spotifyRedirectUri = process.env.SPOTIFY_REDIRECT_URI ||
  'https://YOUR_VERCEL_DOMAIN/api/spotify/callback';

function generateSpotifyAuthUrl(discordUserId: string): string {
  const scope = encodeURIComponent('user-read-private user-read-email user-top-read');
  const state = encodeURIComponent(discordUserId);
  return `https://accounts.spotify.com/authorize?response_type=code&client_id=${spotifyClientId}&scope=${scope}&redirect_uri=${encodeURIComponent(
    spotifyRedirectUri
  )}&state=${state}`;
}

// ---- Helpers ----
async function buffer(request: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// ---- Command handlers ----
async function handleHi() {
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: 'Hi! 👋' },
  };
}

async function handleConnect(userId: string) {
  // Check existing link
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
        flags: 64, // Ephemeral
      },
    };
  }

  const authUrl = generateSpotifyAuthUrl(userId);

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: `Click the link below to connect your Spotify account:\n${authUrl}`,
      flags: 64, // Ephemeral
    },
  };
}

async function fetchTopTracks(accessToken: string) {
  return fetch(
    'https://api.spotify.com/v1/me/top/tracks?limit=10&time_range=medium_term',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
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

async function handleTracks(userId: string) {
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
  let topTracksRes = await fetchTopTracks(accessToken);

  if (topTracksRes.status === 401 && refreshToken) {
    try {
      const refreshed = await refreshSpotifyToken(refreshToken);
      accessToken = refreshed.access_token;
      await supabase
        .from('spotify_tokens')
        .update({ access_token: accessToken, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
      topTracksRes = await fetchTopTracks(accessToken);
    } catch {
      /* ignore */
    }
  }

  if (!topTracksRes.ok) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: 'Failed to fetch your top tracks. Please try again later.',
        flags: 64,
      },
    };
  }

  const json = await topTracksRes.json();
  const tracksList = json.items
    .map(
      (t: any, i: number) => `${i + 1}. ${t.name} – ${t.artists.map((a: any) => a.name).join(', ')}`
    )
    .join('\n');

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: `🎵 **Your Top 10 Tracks:**\n${tracksList}`,
    },
  };
}

// ---- Main handler ----
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rawBody = await buffer(req);
  const sig = req.headers['x-signature-ed25519'] as string;
  const timestamp = req.headers['x-signature-timestamp'] as string;

  const isValid = verifyKey(rawBody, sig, timestamp, publicKey);
  if (!isValid) return res.status(401).send('Invalid request signature');

  const interaction = JSON.parse(rawBody.toString('utf-8'));

  // Reply to pings
  if (interaction.type === InteractionType.PING) {
    return res.status(200).json({ type: InteractionResponseType.PONG });
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const command = interaction.data.name;
    let response;
    switch (command) {
      case 'hi':
        response = await handleHi();
        break;
      case 'connect':
        response = await handleConnect(interaction.member.user.id);
        break;
      case 'tracks':
        response = await handleTracks(interaction.member.user.id);
        break;
      default:
        response = {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: 'Unknown command' },
        };
    }

    return res.status(200).json(response);
  }

  res.status(400).send('Unhandled interaction type');
}

// Disable default body parsing so we can access rawBody for signature verification
export const config = {
  api: {
    bodyParser: false,
  },
}; 