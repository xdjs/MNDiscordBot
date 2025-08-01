import 'dotenv/config';
import { Client, GatewayIntentBits, Partials } from 'discord.js';

const TOKEN = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error('❌  Set DISCORD_TOKEN in your .env');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel], // Needed to receive DM channels in cache
});

client.once('ready', () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  console.log('— Guilds —');
  client.guilds.cache.forEach((g) => console.log(`• ${g.name} (id: ${g.id})`));

  console.log('\n— DM Channels —');
  client.channels.cache
    .filter((c) => c.isDMBased())
    .forEach((c) => {
      const dm = c;
      const recipient = dm.recipient; // For DMChannel
      if (recipient) {
        console.log(`• DM with ${recipient.tag} (user id: ${recipient.id}) channel id: ${dm.id}`);
      } else {
        console.log(`• DM channel id: ${dm.id}`);
      }
    });

  process.exit(0);
});

client.on('error', (err) => {
  console.error('Discord client error', err);
});

client.login(TOKEN);
