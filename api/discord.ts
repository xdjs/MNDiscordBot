import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyKey, InteractionType, InteractionResponseType } from 'discord-interactions';
import 'dotenv/config';

import { connect } from './commands/connect.js';
import { tracks } from './commands/tracks.js';
import { listen } from './commands/listen.js';
import { help } from './commands/help.js';
import { endlisten } from './commands/endlisten.js';
import { chat } from './commands/chat.js';
import { profile } from './commands/profile.js';
import { image as imageCommand } from './commands/image.js';
import { setimage } from './commands/setimage.js';
import { disconnect } from './commands/disconnect.js';
import { wrap as wrapCommand } from './commands/wrap.js';
import { update as updateCommand } from './commands/update.js';
import { unwrap as unwrapCommand } from './commands/unwrap.js';
import { settime } from './commands/settime.js';
import { buildWrapPayload } from '../src/utils/wrapPaginator.js';
import { supabase } from './lib/supabase.js';

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
    // In DMs interaction.member is undefined; use interaction.user as fallback
    const callerId = interaction.member?.user?.id ?? interaction.user?.id;

    switch (name) {
      case 'connect':
        response = await connect(callerId);
        break;
      case 'tracks':
        response = await tracks(callerId);
        break;
      case 'listen': {
        // For a sub-command based slash command, the first option contains the sub-command object.
        const sub = Array.isArray(interaction.data.options) && interaction.data.options.length
          ? (interaction.data.options[0] as any)
          : null;

        const subName = sub?.name ?? 'start';

        if (subName === 'end') {
          // Handle /listen end – terminate current listening session.
          response = await endlisten(interaction);
          break;
        }

        // Default to /listen start flow.
        const opts = sub?.options ?? [];

        let targetUserId = callerId;
        let dmFlag: boolean | undefined = undefined;

        if (Array.isArray(opts)) {
          const userOpt = opts.find((o: any) => o.name === 'user');
          if (userOpt && typeof userOpt.value === 'string') targetUserId = userOpt.value;

          const dmOpt = opts.find((o: any) => o.name === 'dm');
          if (dmOpt !== undefined) dmFlag = Boolean(dmOpt.value);
        }

        response = await listen(
          targetUserId,
          interaction.channel_id,
          interaction.guild_id,
          callerId,
          dmFlag,
        );
        break;
      }
      case 'help':
        response = await help(callerId);
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
        response = await setimage(callerId);
        break;
      case 'disconnect':
        response = await disconnect(callerId);
        break;
      case 'wrap':
        response = await wrapCommand(interaction.guild_id);
        break;
      case 'update':
        response = await updateCommand(interaction.guild_id);
        break;
      case 'unwrap':
        response = await unwrapCommand(interaction);
        break;
      case 'settime':
        response = await settime(interaction);
        break;
      default:
        response = {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: 'Unknown command' },
        };
    }

    return res.status(200).json(response);
  }

  if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
    const custom = interaction.data.custom_id as string;
    if (custom.startsWith('wrap_prev_') || custom.startsWith('wrap_next_')) {
      const direction = custom.startsWith('wrap_prev_') ? -1 : 1;
      const current = parseInt(custom.split('_').pop() || '0', 10);
      const newPage = current + direction;
      const guildId = interaction.guild_id;

      // Fetch latest wrap data
      const { data } = await supabase
        .from('user_tracks')
        .select('user_id, top_track, top_artist')
        .eq('guild_id', guildId);

      const lines = Array.isArray(data)
        ? data.map((row) => {
            const userMention = `<@${row.user_id}>`;
            return `${userMention} — 🎵 **Track:** ${row.top_track ?? 'N/A'} | 🎤 **Artist:** ${row.top_artist ?? 'N/A'}`;
          })
        : [];

      const payload = buildWrapPayload(lines, newPage, 'Spotify Wrap');

      return res.status(200).json({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: payload,
      });
    }
  }

  res.status(400).send('Unhandled interaction type');
}

export const config = {
  api: {
    bodyParser: false,
  },
}; 