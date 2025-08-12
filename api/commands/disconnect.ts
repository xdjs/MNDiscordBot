import { InteractionResponseType } from 'discord-interactions';
import { Client, GatewayIntentBits } from 'discord.js';
import { getVoiceConnection } from '@discordjs/voice';
import { clearIdleDisconnect } from '../../src/utils/voiceIdle.js';
import 'dotenv/config';

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

export async function disconnect(interaction: any) {
  try {
    await ensureClient();
  } catch (err) {
    console.error('[disconnect] client error', err);
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
    const guildId = interaction.guild_id as string;
    const conn = getVoiceConnection(guildId);
    if (!conn) {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: 'I am not connected to a voice channel in this server.', flags: 64 },
      };
    }
    conn.destroy();
    clearIdleDisconnect(guildId);
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: 'Disconnected from the voice channel.', flags: 64 },
    };
  } catch (err) {
    console.error('[disconnect] unexpected error', err);
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: 'Failed to disconnect.', flags: 64 },
    };
  }
}

