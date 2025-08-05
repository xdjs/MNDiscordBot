import 'dotenv/config';
import express from 'express';
import { REST } from 'discord.js';
import { Client as DiscordClient, GatewayIntentBits } from 'discord.js';

// ---------- Route & listener registrations ----------
import { registerPresenceListener } from '../src/listeners/presenceUpdate.js';
import { registerMessageListener } from '../src/listeners/messageCreate.js';
import { initWrapScheduler } from '../src/workers/wrapScheduler.js';
import { loadWrapGuilds, subscribeWrapGuilds, wrapGuilds } from '../src/sessions/wrap.js';

const { PORT = '8080', DISCORD_BOT_TOKEN } = process.env;

if (!DISCORD_BOT_TOKEN) {
  throw new Error('DISCORD_BOT_TOKEN is required');
}

const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);

const client = new DiscordClient({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', async () => {
  console.log(`Discord presence client ready as ${client.user?.tag}`);
  await loadWrapGuilds();
  for (const gid of wrapGuilds) {
    try {
      const g = await client.guilds.fetch(gid);
      await g.members.fetch({ withPresences: true });
    } catch {}
  }
  subscribeWrapGuilds(client);
  initWrapScheduler(client, rest);
});
client.login(DISCORD_BOT_TOKEN);

const app = express();
app.use(express.json());

app.get('/_health', (_, res) => res.send('ok'));

// Register routes

// Register Discord listeners
registerPresenceListener(client, rest);
registerMessageListener(client, rest);

app.get('/', (_, res) => {
  res.send('Listen Receiver up');
});

app.listen(parseInt(PORT, 10), () => {
  console.log(`Listen receiver running on port ${PORT}`);
});
