import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  Interaction,
} from 'discord.js';

// Environment variables
const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID; // Optional, speeds up command registration during development

if (!token || !clientId) {
  throw new Error(
    'DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID must be provided in the environment (e.g., in a .env file).'
  );
}

// Create the client with only the Guilds intent (enough for slash commands)
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`Logged in as ${client.user?.tag}!`);

  // Define the /hi command
  const commands = [
    new SlashCommandBuilder().setName('hi').setDescription('Say hi!').toJSON(),
  ];

  const rest = new REST({ version: '10' }).setToken(token!);

  try {
    console.log('Refreshing application (/) commands...');

    if (guildId) {
      // Register commands for a single guild (instantly available, useful for dev)
      await rest.put(Routes.applicationGuildCommands(clientId!, guildId), {
        body: commands,
      });
      console.log('Successfully registered guild commands.');
    } else {
      // Register global commands (may take up to an hour to appear)
      await rest.put(Routes.applicationCommands(clientId!), { body: commands });
      console.log('Successfully registered global commands.');
    }
  } catch (error) {
    console.error('Failed to register commands:', error);
  }
});

client.on('interactionCreate', async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'hi') {
    await interaction.reply('Hi! 👋');
  }
});

client.login(token); 