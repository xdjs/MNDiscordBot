import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';

const TOKEN = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error('❌  Set DISCORD_TOKEN in your .env');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  console.log('— Guilds —');
  client.guilds.cache.forEach((g) => console.log(`• ${g.name} (id: ${g.id})`));
  process.exit(0);
});

client.on('error', (err) => {
  console.error('Discord client error', err);
});

client.login(TOKEN);
