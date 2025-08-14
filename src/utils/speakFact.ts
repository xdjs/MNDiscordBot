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
import type { Client, Guild, GuildMember, VoiceBasedChannel } from 'discord.js';
import { Readable } from 'stream';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'child_process';
import { getFunFact } from './openai.js';
import { fetchTrackDetails } from './spotify.js';
import { synthesizeSpeech } from './tts.js';
import { scheduleIdleDisconnect, clearIdleDisconnect } from './voiceIdle.js';

const playersByGuild = new Map<string, ReturnType<typeof createAudioPlayer>>();

function getOrCreatePlayer(guildId: string) {
	let p = playersByGuild.get(guildId);
	if (!p) {
		p = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
		p.on('error', (e) => console.error('[speakFact] player error', e));
		p.on(AudioPlayerStatus.Idle, () => {
			// noop
		});
		playersByGuild.set(guildId, p);
	}
	return p;
}

export async function speakFactInVoice(client: Client, guildId: string, userId: string): Promise<string> {
	const guild: Guild = await client.guilds.fetch(guildId);
	const member: GuildMember = await guild.members.fetch(userId);

	const voiceChannel = member.voice?.channel as VoiceBasedChannel | null;
	if (!voiceChannel) throw new Error('User is not in a voice channel');

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
		throw new Error('Failed to establish voice connection');
	}

	const player = getOrCreatePlayer(guild.id);
	connection.subscribe(player);

	// Build fact content similar to /fact
	let track: string | undefined = member.presence?.activities.find((a: any) => a?.name === 'Spotify')?.details ?? undefined;
	let artist: string = member.presence?.activities.find((a: any) => a?.name === 'Spotify')?.state ?? 'Unknown artist';
	const trackId: string | undefined = (member.presence?.activities.find((a: any) => a?.name === 'Spotify') as any)?.syncId ?? undefined;
	if (trackId) {
		try {
			const details = await fetchTrackDetails(trackId);
			if (details) {
				track = details.name || track;
				const joined = details.artists.join(', ');
				if (joined && joined.trim().length) artist = joined;
			}
		} catch {}
	}

	const factText = await getFunFact(artist, track ?? undefined);
	const ttsText = `Here is a fun fact. ${factText.replace(/\n\n\*Our DB[\s\S]*$/i, '').trim()}`;

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
	player.once(AudioPlayerStatus.Idle, () => {
		scheduleIdleDisconnect(guild.id);
	});

	return factText;
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


