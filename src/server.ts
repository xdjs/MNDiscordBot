import express from 'express';
import discordHandler from '../api/discord.js';
// Spin up presence listener in the same process so gateway events are captured even in single-process deployments.
import '../render/listenReceiver.js';

const app = express();

// Serve static landing page and assets from the top-level `public` directory
app.use(express.static('public'));

// Discord interactions endpoint – needs raw body for signature verification
app.post('/api/discord', (req, res) => {
  // Pass the raw request stream directly; discordHandler handles buffering & signature.
  discordHandler(req as any, res as any);
});

// Simple health check (possiible legacy code)
app.get('/_health', (_, res) => res.send('ok'));

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Web process listening on ${PORT}`);
}); 