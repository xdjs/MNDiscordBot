import express from 'express';
import discordHandler from '../api/discord.js';

const app = express();

// Discord interactions endpoint – needs raw body for signature verification
app.post(
  '/api/discord',
  express.raw({ type: '*/*' }),
  (req, res) => discordHandler(req as any, res as any),
);

// Simple health check
app.get('/_health', (_, res) => res.send('ok'));

const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Web process listening on ${PORT}`);
}); 