import { InteractionResponseType } from 'discord-interactions';
import { Client, GatewayIntentBits, ActivityType } from 'discord.js';
import 'dotenv/config';

// Singleton Discord gateway client reused between invocations so that presence data is available.
let client: Client | undefined;
let clientReady: Promise<void> | undefined;

function ensureClient(): Promise<void> {
  if (client && client.isReady()) return Promise.resolve();

  if (!clientReady) {
    clientReady = new Promise((resolve) => {
      const token = process.env.DISCORD_BOT_TOKEN as string;
      if (!token) throw new Error('DISCORD_BOT_TOKEN missing');

      if (!client) {
        client = new Client({
          intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildPresences,
          ],
        });
        client.login(token).catch((err) => {
          console.error('[eavesdrop] client login failed', err);
        });
      }

      if (client.isReady()) resolve();
      else client.once('ready', () => resolve());
    });
  }

  return clientReady;
}

export async function eavesdrop(interaction: any) {
  const opts = interaction.data.options ?? [];
  const userOpt = Array.isArray(opts) ? opts.find((o: any) => o.name === 'user') : undefined;
  const targetUserId = userOpt?.value as string | undefined;

  if (!targetUserId) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: 'You must specify a user.', flags: 64 },
    };
  }

  try {
    await ensureClient();
    if (!client?.isReady()) throw new Error('Discord gateway not ready');

    const guild = await client.guilds.fetch(interaction.guild_id);
    const member = await guild.members.fetch(targetUserId);
    const spotifyAct = member.presence?.activities.find(
      (a) => a.type === ActivityType.Listening && a.name === 'Spotify',
    );

    if (!spotifyAct) {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `I can't detect Spotify activity for <@${targetUserId}> right now.`,
          flags: 64,
        },
      };
    }

    const track = spotifyAct.details ?? 'Unknown track';
    const artist = spotifyAct.state ?? 'Unknown artist';
    const message = `<@${targetUserId}> is listening to **${track}** by **${artist}**`;

    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: message, flags: 64 },
    };
  } catch (err) {
    console.error('[eavesdrop] error', err);
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: 'Failed to fetch that user\'s activity. Try again later.',
        flags: 64,
      },
    };
  }
}
