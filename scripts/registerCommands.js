import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  console.error('DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID must be set');
  process.exit(1);
}

// Define the slash-command payloads for this version of the bot
const commands = [
  new SlashCommandBuilder().setName('hi').setDescription('Say hi!'),
  new SlashCommandBuilder().setName('connect').setDescription('Link your Spotify account'),
  new SlashCommandBuilder().setName('tracks').setDescription('Get your top 10 Spotify tracks'),
  new SlashCommandBuilder()
    .setName('listen')
    .setDescription('Start a listening session')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('The user whose Spotify status to listen to (defaults to yourself)')
        .setRequired(false)
    ),
  new SlashCommandBuilder().setName('help').setDescription('Show help information'),
  new SlashCommandBuilder().setName('chat').setDescription('Prompt questions in #bot-chat'),
].map((c) => c.toJSON());

// Utility to strip Discord-generated fields so we can compare command definitions
function stripGeneratedFields(cmd) {
  const { id, application_id, version, default_permission, default_member_permissions, dm_permission, type, ...rest } = cmd;
  // recurisvely strip generated fields inside options if present
  if (rest.options && Array.isArray(rest.options)) {
    rest.options = rest.options.map(stripGeneratedFields);
  }
  return rest;
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    // Fetch currently-registered commands and compare with our desired payload
    console.log('Fetching currently registered global commands…');
    const current = await rest.get(Routes.applicationCommands(clientId));

    const desiredClean = commands.map(stripGeneratedFields);
    const currentClean = (Array.isArray(current) ? current : []).map(stripGeneratedFields);

    const hasChanges = JSON.stringify(desiredClean) !== JSON.stringify(currentClean);

    if (!hasChanges) {
      console.log('🚀 All commands already up-to-date – skipping re-registration.');
      return;
    }

    console.log('Changes detected – registering global application (/) commands…');
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log('Successfully registered/updated global commands.');
  } catch (error) {
    console.error('Failed to register commands:', error);
    process.exit(1);
  }
})(); 