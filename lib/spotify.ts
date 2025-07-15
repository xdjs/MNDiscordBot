import 'dotenv/config';

export const spotifyClientId = process.env.SPOTIFY_CLIENT_ID!;
export const spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET!;
export const spotifyRedirectUri =
  process.env.SPOTIFY_REDIRECT_URI || 'https://YOUR_VERCEL_DOMAIN/api/spotify/callback';

export function generateSpotifyAuthUrl(discordUserId: string): string {
  const scope = encodeURIComponent('user-read-private user-read-email user-top-read');
  const state = encodeURIComponent(discordUserId);
  return `https://accounts.spotify.com/authorize?response_type=code&client_id=${spotifyClientId}&scope=${scope}&redirect_uri=${encodeURIComponent(
    spotifyRedirectUri,
  )}&state=${state}`;
} 