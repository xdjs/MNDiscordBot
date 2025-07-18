import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyKey, InteractionType, InteractionResponseType } from 'discord-interactions';
import 'dotenv/config';

import { hi } from './commands/hi.js';
import { connect } from './commands/connect.js';
import { tracks } from './commands/tracks.js';
import { listen } from './commands/listen.js';
import { help } from './commands/help.js';
import { chat } from './commands/chat.js';
import { profile } from './commands/profile.js';
import { image as imageCommand } from './commands/image.js';
import { setimage } from './commands/setimage.js';

const publicKey = process.env.DISCORD_PUBLIC_KEY!;

async function buffer(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rawBody = await buffer(req);
  const sig = req.headers['x-signature-ed25519'] as string | undefined;
  const timestamp = req.headers['x-signature-timestamp'] as string | undefined;

  // If the request lacks Discord signature headers, respond 401 instead of throwing
  if (!sig || !timestamp) {
    return res.status(401).send('Signature headers missing');
  }

  const isValid = verifyKey(rawBody, sig, timestamp, publicKey);
  if (!isValid) return res.status(401).send('Invalid request signature');

  const interaction = JSON.parse(rawBody.toString('utf-8'));

  if (interaction.type === InteractionType.PING) {
    return res.status(200).json({ type: InteractionResponseType.PONG });
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const name = interaction.data.name as string;
    let response;
    switch (name) {
      case 'hi':
        response = await hi();
        break;
      case 'connect':
        response = await connect(interaction.member.user.id);
        break;
      case 'tracks':
        response = await tracks(interaction.member.user.id);
        break;
      case 'listen': {
        // If the slash command included a target user option, use that ID; otherwise, fall back to the caller.
        let targetUserId = interaction.member.user.id;
        if (interaction.data.options && Array.isArray(interaction.data.options)) {
          const userOpt = (interaction.data.options as Array<any>).find((opt) => opt.name === 'user');
          if (userOpt && typeof userOpt.value === 'string') {
            targetUserId = userOpt.value;
          }
        }

        response = await listen(
          targetUserId,
          interaction.channel_id,
          interaction.guild_id,
          interaction.member.user.id,
        );
        break;
      }
      case 'help':
        response = await help(interaction.member.user.id);
        break;
      case 'chat':
        response = await chat(interaction.guild_id, interaction.channel_id);
        break;
      case 'profile':
        response = await profile(interaction);
        break;
      case 'image':
        response = await imageCommand(interaction);
        break;
      case 'setimage':
        response = await setimage(interaction.member.user.id);
        break;
      default:
        response = {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: 'Unknown command' },
        };
    }

    return res.status(200).json(response);
  }

  res.status(400).send('Unhandled interaction type');
}

export const config = {
  api: {
    bodyParser: false,
  },
}; 