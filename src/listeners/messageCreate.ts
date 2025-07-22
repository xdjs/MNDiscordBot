import { Client, Message, REST, Routes } from 'discord.js';
import { musicSessions, scheduleMusicTimeout } from '../sessions/music.js';
import { chatChannels, scheduleChatTimeout } from '../sessions/chat.js';
import { getSongFunFact, getChatAnswer, SongContext } from '../utils/openai.js';

export function registerMessageListener(client: Client, rest: REST) {
  client.on('messageCreate', async (message: Message) => {
    if (message.author.id === client.user?.id) return;

    // Music bot now playing flow
    const musicSession = musicSessions.get(message.channel.id);
    if (musicSession && message.author.id === musicSession.botId) {
      const npMatch = /now\s*playing[:]??\s*(.+)/i.exec(message.content);
      if (npMatch && npMatch[1]) {
        const nowPlayingLine = npMatch[1].trim();
        const fact = await getSongFunFact(nowPlayingLine);

        musicSession.factCount += 1;
        scheduleMusicTimeout(message.channel.id);

        if (musicSession.factCount >= 3) {
          if (musicSession.timeout) clearTimeout(musicSession.timeout);
          musicSessions.delete(message.channel.id);
          console.log(`Music session for ${message.channel.id} closed after 3 fun facts.`);
        }

        // Prefer voice channel of bot if available
        let destChannelId = message.channel.id;
        if (message.guild) {
          try {
            const botMember = await message.guild.members.fetch(message.author.id);
            const voiceChan = botMember.voice?.channel;
            if (voiceChan) destChannelId = voiceChan.id;
          } catch (err) {
            console.error('Failed to resolve bot voice channel', err);
          }
        }

        try {
          await rest.post(Routes.channelMessages(destChannelId), { body: { content: `🎶 ${fact}` } });
        } catch (err) {
          console.error('Failed to send song fact', err);
        }
      }
      return; // skip chat flow
    }

    // Chat Q&A flow
    if (!chatChannels.has(message.channel.id)) return;
    if (message.author.bot) return;

    // Capture current song context if author listening
    let songCtx: SongContext | undefined;
    const activities = message.member?.presence?.activities || [];
    const spotifyAct = activities.find((a) => a.type === 2 && a.name === 'Spotify');
    if (spotifyAct) {
      const track = spotifyAct.details || '';
      let artist = spotifyAct.state || '';
      if (!artist) {
        const txt = spotifyAct.assets?.largeText as string | undefined;
        if (txt && txt.includes(' – ')) artist = txt.split(' – ')[0];
      }
      if (track && artist) songCtx = { track, artist };
    }

    const answer = await getChatAnswer(message.content, songCtx);
    scheduleChatTimeout(message.channel.id, client);

    try {
      if (message.channel.isTextBased()) await (message.channel as any).send({ content: answer });
    } catch (err) {
      console.error('Failed to send chat answer', err);
    }
  });
} 