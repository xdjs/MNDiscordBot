import { Client, Message, REST, Routes } from 'discord.js';
import { musicSessions, scheduleMusicTimeout } from './musicSession.js';
import { getSongFunFact } from '../utils/openai.js';

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

       
        // Prefer voice channel of bot if available (The text channle of voice channel)
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

  });
} 