import { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyKey, InteractionType, InteractionResponseType } from 'discord-interactions';
import 'dotenv/config';

import { hi } from './commands/hi';
import { connect } from './commands/connect';
import { tracks } from './commands/tracks';
import { listen } from './commands/listen';

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
  const isValid = verifyKey(
    rawBody,
    req.headers['x-signature-ed25519'] as string,
    req.headers['x-signature-timestamp'] as string,
    publicKey,
  );
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
      case 'listen':
        response = await listen(
          interaction.member.user.id,
          interaction.channel_id,
          interaction.guild_id,
        );
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