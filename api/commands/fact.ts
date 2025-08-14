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
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'child_process';
import { supabase } from '../lib/supabase.js';
import { getFunFact } from '../../src/utils/openai.js';
import { fetchTrackDetails } from '../../src/utils/spotify.js';
import { synthesizeSpeech } from '../../src/utils/tts.js';
import { scheduleIdleDisconnect, clearIdleDisconnect } from '../../src/utils/voiceIdle.js';
import { patchOriginal } from '../../src/utils/discord.js';
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
  const appId: string = interaction.application_id;
  const webhookToken: string = interaction.token;

  // Run the heavy work asynchronously to avoid 3s interaction timeout
  (async () => {
    try {
      await ensureClient();
      if (!client) throw new Error('Client unavailable');

      const guild = await client.guilds.fetch(interaction.guild_id);
      const userId = interaction.member?.user?.id ?? interaction.user?.id;
      const member = await guild.members.fetch(userId);

      const voiceChannel = member.voice?.channel as VoiceBasedChannel | null;
      if (!voiceChannel || (voiceChannel.type !== ChannelType.GuildVoice && voiceChannel.type !== ChannelType.GuildStageVoice)) {
        await patchOriginal(appId, webhookToken, { content: 'Join a voice channel first, then use /fact.', flags: 64 }, 'fact');
        return;
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
        await patchOriginal(appId, webhookToken, { content: 'I couldn’t connect to the voice channel. Try again.', flags: 64 }, 'fact');
        return;
      }

      const player = getOrCreatePlayer(guild.id);
      connection.subscribe(player);

      // Detect Spotify activity and build fact text
      const spotifyAct = member.presence?.activities.find(
        (a) => a.type === ActivityType.Listening && a.name === 'Spotify',
      );
      if (!spotifyAct) {
        await patchOriginal(appId, webhookToken, { content: 'I cannot detect your Spotify activity. Make sure activity is visible and you’re playing a song.', flags: 64 }, 'fact');
        return;
      }

      // Prefer canonical values from Spotify API using syncId when available
      const trackId: string | undefined = (spotifyAct as any)?.syncId ?? undefined;
      let track = spotifyAct.details ?? undefined;
      let artist = spotifyAct.state ?? 'Unknown artist';

      if (trackId) {
        try {
          const details = await fetchTrackDetails(trackId);
          if (details) {
            track = details.name || track;
            const joined = details.artists.join(', ');
            // Only replace if artists array is non-empty
            if (joined && joined.trim().length) artist = joined;
          }
        } catch (e) {
          console.warn('[fact] failed to fetch canonical track details', e);
        }
      }

      // Best-effort: touch prompt row so DB connections are warmed similarly to nerdout
      try { await supabase.from('bot_prompts').select('fun_fact').limit(1).single(); } catch {}

      let factText = await getFunFact(artist, track ?? undefined);
      const ttsText = `Here is a fun fact. ${factText.replace(/\n\n\*Our DB[\s\S]*$/i, '').trim()}`;

      // TTS via ElevenLabs
      const webStream = await synthesizeSpeech(ttsText);
      const nodeStream = ReadableFromWeb(webStream);
      const ffmpegArgs = [
        '-analyzeduration', '0',
        '-loglevel', '0',
        '-i', 'pipe:0',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        'pipe:1',
      ];
      const ffmpegBin = (ffmpegPath as unknown as string) || 'ffmpeg';
      const ffmpeg = spawn(ffmpegBin, ffmpegArgs, { stdio: ['pipe', 'pipe', 'ignore'] });
      nodeStream.pipe(ffmpeg.stdin);
      const pcmOut = ffmpeg.stdout;
      const resource = createAudioResource(pcmOut, { inputType: StreamType.Raw });
      clearIdleDisconnect(guild.id);
      player.play(resource);

      // After playback ends, reschedule idle disconnect
      player.once(AudioPlayerStatus.Idle, () => {
        scheduleIdleDisconnect(guild.id);
      });

      await patchOriginal(appId, webhookToken, { content: `🎶 ${factText}`, flags: 64 }, 'fact');
    } catch (err) {
      console.error('[fact] unexpected error', err);
      await patchOriginal(appId, webhookToken, { content: 'Failed to speak a fun fact. Please try again.', flags: 64 }, 'fact');
    }
  })();

  // Immediate defer so Discord does not time out
  return {
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: { flags: 64 },
  };
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

