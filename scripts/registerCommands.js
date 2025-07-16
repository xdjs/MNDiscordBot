import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  console.error('DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID must be set');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder().setName('hi').setDescription('Say hi!'),
  new SlashCommandBuilder().setName('connect').setDescription('Link your Spotify account'),
  new SlashCommandBuilder().setName('tracks').setDescription('Get your top 10 Spotify tracks'),
  new SlashCommandBuilder().setName('listen').setDescription('Start a listening session'),
].map((c) => c.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log('Registering global application (/) commands…');
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log('Successfully registered global commands.');
  } catch (error) {
    console.error('Failed to register commands:', error);
    process.exit(1);
  }
})(); 