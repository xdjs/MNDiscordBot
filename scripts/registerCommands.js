import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder, ChannelType } from 'discord.js';

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID; // Optional: when set, registers as guild commands for instant availability

if (!token || !clientId) {
  console.error('DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID must be set');
  process.exit(1);
}

// Define the slash-command payloads for this version of the bot
const commands = [
  new SlashCommandBuilder().setName('help').setDescription('Show help information').setDMPermission(true),
  new SlashCommandBuilder()
    .setName('nerdout')
    .setDescription('Get a fun fact about the song you’re listening to (ephemeral)')
    .setDMPermission(true),
  new SlashCommandBuilder()
    .setName('eavesdrop')
    .setDescription('Show what a user is currently listening to (ephemeral)')
    .addUserOption((opt) => opt.setName('user').setDescription('Target user').setRequired(true)),
  new SlashCommandBuilder()
    .setName('connect')
    .setDescription('Have the bot join your current voice channel')
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('fact')
    .setDescription('Speak a fun music fact in your voice channel (ephemeral ack)')
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('listen')
    .setDescription('Toggle voice listening with wake word “bot” (VC only)')
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('disconnect')
    .setDescription('Disconnect the bot from the voice channel')
    .setDMPermission(false),
  new SlashCommandBuilder().setName('wrap').setDescription('Start daily Spotify wrap tracking for this server').setDMPermission(false),
  new SlashCommandBuilder().setName('update').setDescription('Show current wrap standings for this server').setDMPermission(false),
  new SlashCommandBuilder().setName('unwrap').setDescription('Stop daily Spotify wrap tracking for this server').setDMPermission(false),
  new SlashCommandBuilder()
    .setName('settime')
    .setDescription('Set your local time (HH:MM) for wrap-up posts')
    .setDMPermission(true)
    .addStringOption((opt) => opt.setName('time').setDescription('Your local time (24h HH:MM)').setRequired(true)),
  new SlashCommandBuilder()
    .setName('setchannel')
    .setDescription('Set the text channel for daily wrap posts')
    .setDMPermission(false)
    .addChannelOption((opt) =>
      opt
        .setName('channel')
        .setDescription('Pick a text channel for wrap posts')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText)
    ),
  new SlashCommandBuilder()
    .setName('setinterval')
    .setDescription('Set hourly interval (1–6) for wrap posts; >6 = daily')
    .setDMPermission(false)
    .addIntegerOption((opt) =>
      opt
        .setName('hours')
        .setDescription('Number of hours between wraps (1–6); >6 = daily')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(24)
    ),
].map((c) => c.toJSON());

// Utility to strip Discord-generated fields so we can compare command definitions
function stripGeneratedFields(cmd) {
  const { id, application_id, version, default_permission, default_member_permissions, dm_permission, type, ...rest } = cmd;
  if (rest.options && Array.isArray(rest.options)) {
    rest.options = rest.options.map(stripGeneratedFields);
  }
  return rest;
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    const scope = guildId ? `guild ${guildId}` : 'global';
    console.log(`Fetching currently registered ${scope} commands…`);

    const routeGet = guildId
      ? Routes.applicationGuildCommands(clientId, guildId)
      : Routes.applicationCommands(clientId);
    const current = await rest.get(routeGet);

    const desiredClean = commands.map(stripGeneratedFields);
    const currentClean = (Array.isArray(current) ? current : []).map(stripGeneratedFields);

    const hasChanges = JSON.stringify(desiredClean) !== JSON.stringify(currentClean);

    if (!hasChanges) {
      console.log('🚀 All commands already up-to-date – skipping re-registration.');
      return;
    }

    console.log(`Changes detected – registering ${scope} application (/) commands…`);
    const routePut = guildId
      ? Routes.applicationGuildCommands(clientId, guildId)
      : Routes.applicationCommands(clientId);
    await rest.put(routePut, { body: commands });
    console.log(`Successfully registered/updated ${scope} commands.${guildId ? ' (Guild commands are instant.)' : ''}`);
  } catch (error) {
    console.error('Failed to register commands:', error);
    process.exit(1);
  }
})();