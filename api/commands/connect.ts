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
  try {
    await ensureClient();
  } catch (err) {
    console.error('[connect] client error', err);
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: 'Internal error – bot not ready.', flags: 64 },
    };
  }

  if (!client) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: 'Internal error – client unavailable.', flags: 64 },
    };
  }

  try {
    const guild = await client.guilds.fetch(interaction.guild_id);
    const userId = interaction.member?.user?.id ?? interaction.user?.id;
    const member = await guild.members.fetch(userId);

    const voiceChannel = member.voice?.channel as VoiceBasedChannel | null;
    if (
      !voiceChannel ||
      (voiceChannel.type !== ChannelType.GuildVoice && voiceChannel.type !== ChannelType.GuildStageVoice)
    ) {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: 'Join a voice channel first, then use /connect.', flags: 64 },
      };
    }

    let connection = getVoiceConnection(guild.id);
    if (!connection) {
      connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator as any,
        selfDeaf: true,
      });
    }

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    } catch (e) {
      console.error('[connect] failed to establish voice connection', e);
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: 'I couldn’t connect to the voice channel. Try again.', flags: 64 },
      };
    }

    // On successful connect, start idle timer
    clearIdleDisconnect(guild.id);
    scheduleIdleDisconnect(guild.id);

    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: `Connected to ${voiceChannel.name}.`, flags: 64 },
    };
  } catch (err) {
    console.error('[connect] unexpected error', err);
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: 'Failed to connect.', flags: 64 },
    };
  }
}

