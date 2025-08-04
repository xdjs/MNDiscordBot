import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyKey, InteractionType, InteractionResponseType } from 'discord-interactions';
import 'dotenv/config';

import { connect } from './commands/connect.js';
import { tracks } from './commands/tracks.js';
import { listen } from './commands/listen.js';
import { help } from './commands/help.js';
import { endlisten } from './commands/endlisten.js';
import { profile } from './commands/profile.js';
import { image as imageCommand } from './commands/image.js';
import { setimage } from './commands/setimage.js';
import { disconnect } from './commands/disconnect.js';
import { wrap as wrapCommand } from './commands/wrap.js';
import { update as updateCommand } from './commands/update.js';
import { unwrap as unwrapCommand } from './commands/unwrap.js';
import { settime } from './commands/settime.js';
import { buildWrapPayload } from '../src/utils/wrapPaginator.js';
import { fetchArtistLinksByName } from '../src/services/artistLinks.js';
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

      // Fetch latest wrap snapshot (falls back to user_tracks for legacy)
      let data: any[] | null = null;
      const snapRes = await supabase.from('wrap_guilds').select('wrap_up').eq('guild_id', guildId).maybeSingle();
      if (snapRes.data?.wrap_up && Array.isArray(snapRes.data.wrap_up)) {
        data = snapRes.data.wrap_up;
      } else {
        // Legacy fallback – happens if snapshot not stored yet
        const res = await supabase
          .from('user_tracks')
          .select('user_id, top_track, top_artist')
          .eq('guild_id', guildId);
        data = res.data as any[];
      }

      // Filter out rows where both top_track and top_artist are null
      const rows = Array.isArray(data) ? data.filter((r) => r.top_track !== null || r.top_artist !== null) : [];

            const lines = rows.map((row) => {
            const userMention = `<@${row.user_id}>`;
            return `${userMention} — 🎵 **Track:** ${row.top_track ?? 'N/A'} | 🎤 **Artist:** ${row.top_artist ?? 'N/A'}`;
          });

      const userRowsPage = rows.slice(newPage * 5, newPage * 5 + 5);

      // Preserve the original summary prompt, blank line separator, and accent colour from the
      // original embed so that every paginated view looks identical.
      const origEmbed = (interaction as any).message?.embeds?.[0] as any | undefined;
      const origDescLines = origEmbed?.description ? (origEmbed.description as string).split('\n') : [];
      const headerLines = origDescLines.slice(0, 2); // summary prompt + blank line
      const accent = origEmbed?.color;

      // Build the full list with the preserved header so the summary is always present.
      const allLines = [...headerLines, ...lines];

      const payload = buildWrapPayload(allLines, newPage, 'Daily Wrap', userRowsPage, accent);

      return res.status(200).json({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: payload,
      });
    }

    // -------- Numeric selection (1-5) --------
    if (custom.startsWith('wrap_pick_')) {
      const userId = custom.replace('wrap_pick_', '');

      // Check age of message via Discord snowflake (first 42 bits are timestamp)
      const snowflake = BigInt(interaction.message.id);
      const discordEpoch = 1420070400000n;
      const msgTimestamp = Number((snowflake >> 22n) + discordEpoch);
      if (Date.now() - msgTimestamp > 60 * 60 * 1000) {
        return res.status(200).json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: '⏰ This wrap summary has expired. Try again tomorrow!',
            flags: 64, // EPHEMERAL
          },
        });
      }

      // Fetch artist from snapshot first
      let artistName: string | undefined;
      const snap = await supabase.from('wrap_guilds').select('wrap_up').eq('guild_id', interaction.guild_id).maybeSingle();
      if (snap.data?.wrap_up && Array.isArray(snap.data.wrap_up)) {
        const match = snap.data.wrap_up.find((r: any) => r.user_id === userId);
        artistName = match?.top_artist;
      }
      if (!artistName) {
        const { data: row } = await supabase
          .from('user_tracks')
          .select('top_artist')
          .eq('user_id', userId)
          .eq('guild_id', interaction.guild_id)
          .maybeSingle();
        artistName = row?.top_artist as string | undefined;
      }
      if (!artistName) {
        return res.status(200).json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `I don't have data for this user yet.`,
            flags: 64,
          },
        });
      }

      const info = await fetchArtistLinksByName(artistName);

      const baseUrl = process.env.BASE_URL || 'https://your-site.com';
      let replyLines: string[] = [`**${artistName}**`];
      if (info && !(info as any).skip) {
        if (info.bio && info.bio.trim().length) {
          replyLines.push(info.bio.trim());
          replyLines.push(`Check out this artist: ${baseUrl}/artist/${info.id}`);
        } else {
          replyLines.push(`This artist doesn't have a bio yet, but feel free to check them out: ${baseUrl}/artist/${info.id}`);
        }
      } else {
        replyLines.push(`I couldn't find this artist in the database yet, feel free to add them: ${baseUrl}`);
      }

      return res.status(200).json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: replyLines.join('\n'),
          flags: 64,
        },
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