import express from 'express';
import discordHandler from '../api/discord.js';
import spotifyCallbackHandler from '../api/spotify/callback.js';
// Spin up presence listener in the same process so gateway events are captured even in single-process deployments.
import '../render/listenReceiver.js';

const app = express();

// Discord interactions endpoint – needs raw body for signature verification
app.post('/api/discord', (req, res) => {
  // Pass the raw request stream directly; discordHandler handles buffering & signature.
  discordHandler(req as any, res as any);
});

// Spotify OAuth redirect/callback (GET)
app.get('/api/spotify/callback', (req, res) => {
  // Delegate to the existing handler used in serverless envs
  spotifyCallbackHandler(req as any, res as any);
});

// Simple health check
app.get('/_health', (_, res) => res.send('ok'));

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Web process listening on ${PORT}`);
}); 