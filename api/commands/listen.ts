import { InteractionResponseType } from 'discord-interactions';
import { Client, GatewayIntentBits, ChannelType, VoiceBasedChannel } from 'discord.js';
import { joinVoiceChannel, getVoiceConnection, VoiceConnectionStatus, entersState } from '@discordjs/voice';
import 'dotenv/config';
import { patchOriginal } from '../../src/utils/discord.js';
import { startGuildListening, stopGuildListening, isGuildListening } from '../../src/utils/wakeWord.js';

let client: Client | undefined;
let readyPromise: Promise<void> | undefined;

function ensureClient(): Promise<void> {
  if (client && client.isReady()) return Promise.resolve();
  if (!readyPromise) {
    readyPromise = new Promise(async (resolve, reject) => {
      const token = process.env.DISCORD_BOT_TOKEN;
      if (!token) return reject(new Error('DISCORD_BOT_TOKEN missing'));

      if (!client) {
        client = new Client({
          intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildPresences,
            GatewayIntentBits.GuildVoiceStates,
          ],
        });
        try {
          const res = client.login(token);
          if (res && typeof (res as any).then === 'function') {
            await res.catch(reject);
          }
        } catch (err) {
          reject(err);
        }
      }

      if (client.isReady()) resolve();
      else client.once('ready', () => resolve());
    });
  }
  return readyPromise;
}

export async function listen(interaction: any) {
  const appId: string = interaction.application_id;
  const webhookToken: string = interaction.token;

  (async () => {
    try {
      await ensureClient();
      if (!client) throw new Error('Client unavailable');

      const guild = await client.guilds.fetch(interaction.guild_id);
      const userId = interaction.member?.user?.id ?? interaction.user?.id;
      const member = await guild.members.fetch(userId);

      const voiceChannel = member.voice?.channel as VoiceBasedChannel | null;
      if (!voiceChannel || (voiceChannel.type !== ChannelType.GuildVoice && voiceChannel.type !== ChannelType.GuildStageVoice)) {
        await patchOriginal(appId, webhookToken, { content: 'Join a voice channel first, then use /listen.', flags: 64 }, 'listen');
        return;
      }

      let connection = getVoiceConnection(guild.id);
      if (!connection) {
        connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: guild.id,
          adapterCreator: guild.voiceAdapterCreator as any,
          selfDeaf: false,
        });
      }

      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
      } catch (e) {
        await patchOriginal(appId, webhookToken, { content: 'I couldn’t connect to the voice channel. Try again.', flags: 64 }, 'listen');
        return;
      }

      const toggledOn = !isGuildListening(guild.id);
      if (toggledOn) {
        startGuildListening(client, guild.id);
        await patchOriginal(appId, webhookToken, { content: 'Listening for “bot”…', flags: 64 }, 'listen');
      } else {
        stopGuildListening(guild.id);
        await patchOriginal(appId, webhookToken, { content: 'Stopped listening.', flags: 64 }, 'listen');
      }
    } catch (err) {
      console.error('[listen] unexpected error', err);
      await patchOriginal(appId, webhookToken, { content: 'Failed to toggle listening.', flags: 64 }, 'listen');
    }
  })();

  return {
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: { flags: 64 },
  };
}


