import { InteractionResponseType } from 'discord-interactions';
import { Client, GatewayIntentBits, ActivityType, ChannelType, VoiceBasedChannel } from 'discord.js';
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  getVoiceConnection,
  NoSubscriberBehavior,
  StreamType,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} from '@discordjs/voice';
import { Readable } from 'stream';
import prism from 'prism-media';
import { supabase } from '../lib/supabase.js';
import { getFunFact } from '../../src/utils/openai.js';
import { synthesizeSpeech } from '../../src/utils/tts.js';
import { scheduleIdleDisconnect, clearIdleDisconnect } from '../../src/utils/voiceIdle.js';
import 'dotenv/config';

let client: Client | undefined;
let readyPromise: Promise<void> | undefined;
let playersByGuild = new Map<string, ReturnType<typeof createAudioPlayer>>();

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

//the audio player for the fact command (same as nerdout)
function getOrCreatePlayer(guildId: string) {
  let p = playersByGuild.get(guildId);
  if (!p) {
    p = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    p.on('error', (e) => console.error('[fact] player error', e));
    p.on(AudioPlayerStatus.Idle, () => {
      // Optional: could disconnect after some idle time
    });
    playersByGuild.set(guildId, p);
  }
  return p;
}

export async function fact(interaction: any) {
  try {
    await ensureClient();
  } catch (err) {
    console.error('[fact] client error', err);
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
    if (!voiceChannel || (voiceChannel.type !== ChannelType.GuildVoice && voiceChannel.type !== ChannelType.GuildStageVoice)) {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: 'Join a voice channel first, then use /fact.', flags: 64 },
      };
    }

    // Ensure voice connection
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
      console.error('[fact] failed to establish voice connection', e);
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: 'I couldn’t connect to the voice channel. Try again.', flags: 64 },
      };
    }

    const player = getOrCreatePlayer(guild.id);
    connection.subscribe(player);

    // Detect Spotify activity and build fact text (same logic as nerdout)
    const spotifyAct = member.presence?.activities.find(
      (a) => a.type === ActivityType.Listening && a.name === 'Spotify',
    );
    if (!spotifyAct) {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: 'I cannot detect your Spotify activity. Make sure activity is visible and you’re playing a song.',
          flags: 64,
        },
      };
    }

    const track = spotifyAct.details ?? undefined;
    const artist = spotifyAct.state ?? 'Unknown artist';

    // Load custom prompt (mirroring nerdout path; not overriding getFunFact for now)
    try {
      await supabase
        .from('bot_prompts')
        .select('fun_fact')
        .limit(1)
        .single();
    } catch (err) {
      // best-effort; ignore
    }

    let factText = await getFunFact(artist, track ?? undefined);

    // TTS via ElevenLabs
    const webStream = await synthesizeSpeech(`Here is a fun fact. ${factText}`);
    const nodeStream = ReadableFromWeb(webStream);
    const ffmpeg = new prism.FFmpeg({
      args: [
        '-analyzeduration', '0',
        '-loglevel', '0',
        '-i', 'pipe:0',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        'pipe:1',
      ],
    });
    const pcmStream = nodeStream.pipe(ffmpeg);
    const resource = createAudioResource(pcmStream, { inputType: StreamType.Raw });
    clearIdleDisconnect(guild.id);
    player.play(resource);

    // After playback ends, reschedule idle disconnect
    player.once(AudioPlayerStatus.Idle, () => {
      scheduleIdleDisconnect(guild.id);
    });

    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: `🎶 ${factText}`, flags: 64 },
    };
  } catch (err) {
    console.error('[fact] unexpected error', err);
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: 'Failed to speak a fun fact. Please try again.', flags: 64 },
    };
  }
}

function ReadableFromWeb(stream: ReadableStream<Uint8Array>): Readable {
  const reader = stream.getReader();
  return new Readable({
    read() {
      reader.read()
        .then(({ done, value }) => {
          if (done) this.push(null);
          else this.push(Buffer.from(value));
        })
        .catch((e) => this.destroy(e));
    },
  });
}

