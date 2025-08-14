import { getVoiceConnection, VoiceReceiver } from '@discordjs/voice';
import type { Client } from 'discord.js';
import prism from 'prism-media';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { speakFactInVoice } from './speakFact.js';

type GuildState = {
  interval?: NodeJS.Timeout;
  receiver?: VoiceReceiver;
  ringBuffers: Map<string, Buffer[]>; // per-user small chunks
  listening: boolean;
  cooldownUntil: number;
};

const guildStates = new Map<string, GuildState>();

const SAMPLE_RATE = 16000;
const CHUNK_MS = 200; // buffer chunk size
const WAKE_WINDOW_MS = Number(process.env.WAKE_WINDOW_MS ?? 2500);
const COMMAND_WINDOW_MS = Number(process.env.COMMAND_WINDOW_MS ?? 8000);
const WAKE_WORD = (process.env.WAKE_WORD ?? 'bot').toLowerCase();
const WHISPER_BIN = process.env.WHISPER_BIN ?? 'whisper';
const TINY_MODEL = process.env.WHISPER_TINY_MODEL ?? '';
const SMALL_MODEL = process.env.WHISPER_SMALL_MODEL ?? '';

export function isGuildListening(guildId: string): boolean {
  return guildStates.get(guildId)?.listening === true;
}

export function stopGuildListening(guildId: string): void {
  const st = guildStates.get(guildId);
  if (!st) return;
  if (st.interval) clearInterval(st.interval);
  st.interval = undefined;
  st.listening = false;
  st.ringBuffers.clear();
  guildStates.delete(guildId);
}

export function startGuildListening(client: Client, guildId: string): void {
  stopGuildListening(guildId);
  const conn = getVoiceConnection(guildId);
  if (!conn) throw new Error('No voice connection for guild');

  const receiver = conn.receiver;
  const state: GuildState = { interval: undefined, receiver, ringBuffers: new Map(), listening: true, cooldownUntil: 0 };
  guildStates.set(guildId, state);

  receiver.speaking.on('start', (userId) => {
    const opusStream = receiver.subscribe(userId, { end: { behavior: 1 } });
    const decoder = new prism.opus.Decoder({ channels: 2, rate: 48000, frameSize: 960 });
    const downmix = new prism.FFmpeg({ cmd: (ffmpegPath as unknown as string) || 'ffmpeg', args: ['-f', 's16le', '-ar', '48000', '-ac', '2', '-i', 'pipe:0', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', 'pipe:1'] });
    opusStream.pipe(decoder).pipe(downmix);
    const chunks: Buffer[] = [];
    state.ringBuffers.set(userId, chunks);
    downmix.on('data', (buf: Buffer) => {
      chunks.push(buf);
      trimRing(chunks, WAKE_WINDOW_MS + 5000);
    });
    downmix.on('end', () => {
      // keep last few seconds for windowing
    });
  });

  state.interval = setInterval(async () => {
    if (!state.listening) return;
    if (Date.now() < state.cooldownUntil) return;

    for (const [userId, chunks] of state.ringBuffers.entries()) {
      const windowBuf = takeWindow(chunks, WAKE_WINDOW_MS);
      if (!windowBuf) continue;
      try {
        const text = await transcribeWithWhisper(windowBuf, TINY_MODEL);
        if (text && text.toLowerCase().includes(WAKE_WORD)) {
          state.cooldownUntil = Date.now() + 3000;
          const commandBuf = takeWindow(chunks, COMMAND_WINDOW_MS);
          const cmdText = await transcribeWithWhisper(commandBuf, SMALL_MODEL);
          if (/give\s+me\s+(a\s+)?fun\s+fact/i.test(cmdText)) {
            try { await speakFactInVoice(client, guildId, userId); } catch {}
          }
          stopGuildListening(guildId);
          break;
        }
      } catch (e) {
        // swallow transient errors
      }
    }
  }, 800);
}

function trimRing(chunks: Buffer[], keepMs: number): void {
  const bytesPerMs = (SAMPLE_RATE * 2) / 1000;
  let total = chunks.reduce((a, b) => a + b.length, 0);
  const maxBytes = Math.max(bytesPerMs * keepMs, bytesPerMs * 2000);
  while (total > maxBytes && chunks.length > 1) {
    const removed = chunks.shift();
    if (removed) total -= removed.length;
  }
}

function takeWindow(chunks: Buffer[], ms: number): Buffer | null {
  if (!chunks.length) return null;
  const bytesPerMs = (SAMPLE_RATE * 2) / 1000;
  const target = Math.max(bytesPerMs * ms, bytesPerMs * 500);
  let acc: Buffer[] = [];
  let total = 0;
  for (let i = chunks.length - 1; i >= 0; i--) {
    acc.unshift(chunks[i]);
    total += chunks[i].length;
    if (total >= target) break;
  }
  return Buffer.concat(acc);
}

async function transcribeWithWhisper(pcmS16LEMono16k: Buffer, modelPath: string): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-'));
  const wavPath = path.join(tmpDir, 'audio.wav');
  const wav = pcmToWav(pcmS16LEMono16k, SAMPLE_RATE);
  fs.writeFileSync(wavPath, wav);
  return await new Promise((resolve) => {
    const args = ['-m', modelPath, '-l', process.env.LANGUAGE ?? 'en', '-nt', '-f', wavPath];
    const proc = spawn(WHISPER_BIN, args);
    let out = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.on('close', () => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      resolve((out || '').trim());
    });
    proc.on('error', () => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      resolve('');
    });
  });
}

function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcm.length;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcm.copy(buffer, 44);
  return buffer;
}


