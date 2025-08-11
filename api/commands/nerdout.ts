import { InteractionResponseType } from 'discord-interactions';
import { Client, GatewayIntentBits, ActivityType } from 'discord.js';
import { supabase } from '../lib/supabase.js';
import { getFunFact } from '../../src/utils/openai.js';
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

export async function nerdout(interaction: any) {
  try {
    await ensureClient();
  } catch (err) {
    console.error('[nerdout] client error', err);
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
    const member = await guild.members.fetch(interaction.member?.user?.id ?? interaction.user?.id);
    const spotifyAct = member.presence?.activities.find(
      (a) => a.type === ActivityType.Listening && a.name === 'Spotify',
    );

    if (!spotifyAct) {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: 'I cannot detect your Spotify activity. Make sure "Display current activity" is enabled and you are playing a song.',
          flags: 64,
        },
      };
    }

    const track = spotifyAct.details ?? undefined;
    const artist = spotifyAct.state ?? 'Unknown artist';

    // Load custom prompt
    let promptBase: string | undefined;
    try {
      const { data } = await supabase
        .from('bot_prompts')
        .select('fun_fact')
        .limit(1)
        .single();
      promptBase = data?.fun_fact ?? undefined;
    } catch (err) {
      console.error('[nerdout] failed to load prompt', err);
    }

    let fact: string;
    if (promptBase) {
      const prompt = promptBase
        .replace('{artist}', artist)
        .replace('{track}', track ?? '');
      fact = await getFunFact(artist, track ?? undefined);
      // getFunFact already uses fun_fact internally; if we want to override we'd need new util, so fallback
    } else {
      fact = await getFunFact(artist, track ?? undefined);
    }

    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: `🎶 ${fact}`, flags: 64 },
    };
  } catch (err) {
    console.error('[nerdout] unexpected error', err);
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: 'Failed to fetch a fun fact. Please try again.',
        flags: 64,
      },
    };
  }
}
