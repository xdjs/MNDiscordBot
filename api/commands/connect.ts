import { InteractionResponseType } from 'discord-interactions';
import { Client, GatewayIntentBits, ChannelType, VoiceBasedChannel } from 'discord.js';
import {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState,
} from '@discordjs/voice';
import 'dotenv/config';
import { scheduleIdleDisconnect, clearIdleDisconnect } from '../../src/utils/voiceIdle.js';
import { patchOriginal } from '../../src/utils/discord.js';

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

export async function connect(interaction: any) {
  const appId: string = interaction.application_id;
  const webhookToken: string = interaction.token;

  // Fire-and-forget the heavy work to avoid 3s interaction timeout
  (async () => {
    try {
      await ensureClient();
      if (!client) throw new Error('Client unavailable');

      const guild = await client.guilds.fetch(interaction.guild_id);
      const userId = interaction.member?.user?.id ?? interaction.user?.id;
      const member = await guild.members.fetch(userId);

      const voiceChannel = member.voice?.channel as VoiceBasedChannel | null;
      if (!voiceChannel || (voiceChannel.type !== ChannelType.GuildVoice && voiceChannel.type !== ChannelType.GuildStageVoice)) {
        await patchOriginal(appId, webhookToken, { content: 'Join a voice channel first, then use /connect.', flags: 64 }, 'connect');
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
        console.error('[connect] failed to establish voice connection', e);
        await patchOriginal(appId, webhookToken, { content: 'I couldn’t connect to the voice channel. Try again.', flags: 64 }, 'connect');
        return;
      }

      clearIdleDisconnect(guild.id);
      scheduleIdleDisconnect(guild.id);

      await patchOriginal(appId, webhookToken, { content: `Connected to ${voiceChannel.name}.`, flags: 64 }, 'connect');
    } catch (err) {
      console.error('[connect] unexpected error', err);
      await patchOriginal(appId, webhookToken, { content: 'Failed to connect.', flags: 64 }, 'connect');
    }
  })();

  // Immediate defer so Discord doesn’t time out the interaction
  return {
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: { flags: 64 },
  };
}

