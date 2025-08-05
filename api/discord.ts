import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyKey, InteractionType, InteractionResponseType } from 'discord-interactions';
import 'dotenv/config';



import { listen } from './commands/listen.js';
import { help } from './commands/help.js';
import { endlisten } from './commands/endlisten.js';




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
//Discord bot verification pings
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

 //Switch case for all commands
    switch (name) {

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

      const isTrackEmbed = origEmbed?.title?.includes('Top Tracks');
      let payload = buildWrapPayload(allLines, newPage, origEmbed?.title ?? 'Daily Wrap', userRowsPage, accent);
      if (isTrackEmbed) {
        // convert button ids and labels for track facts
        payload.components?.forEach((row: any) => {
          row.components?.forEach((c: any) => {
            if (typeof c.custom_id === 'string' && c.custom_id.startsWith('wrap_pick_')) {
              c.custom_id = c.custom_id.replace('wrap_pick_', 'wrap_track_');
            }
            if (typeof c.label === 'string' && !c.label.includes('🔎')) {
              c.label = `${c.label} 🔎`;
            }
          });
        });
      }

      return res.status(200).json({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: payload,
      });
    }

    // --------5 buttons for the artists bio --------
    if (custom.startsWith('wrap_pick_')) {
      const userId = custom.replace('wrap_pick_', '');



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

      //----------Artist bio retrieval----------
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

    // ---- Track fact buttons ----
    if (custom.startsWith('wrap_track_')) {
      const userId = custom.replace('wrap_track_', '');

      // Fetch track & artist from snapshot first
      let trackName: string | undefined;
      let artistName: string | undefined;
      const snap = await supabase
        .from('wrap_guilds')
        .select('wrap_up')
        .eq('guild_id', interaction.guild_id)
        .maybeSingle();
      if (snap.data?.wrap_up && Array.isArray(snap.data.wrap_up)) {
        const match = snap.data.wrap_up.find((r: any) => r.user_id === userId);
        trackName = match?.top_track;
        artistName = match?.top_artist;
      }
      if (!trackName) {
        const { data: row } = await supabase
          .from('user_tracks')
          .select('top_track, top_artist')
          .eq('user_id', userId)
          .eq('guild_id', interaction.guild_id)
          .maybeSingle();
        trackName = row?.top_track as string | undefined;
        artistName = row?.top_artist as string | undefined;
      }
      if (!trackName) {
        return res.status(200).json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: `I don't have data for this user's top track yet.`, flags: 64 },
        });
      }

      // Load prompt template
      let trackPrompt: string | null = null;
      try {
        const { data } = await supabase
          .from('Summary_prompts')
          .select('track_fact')
          .limit(1)
          .single();
        trackPrompt = (data?.track_fact as string) ?? null;
      } catch (err) {
        console.error('[wrap_track] failed to load track_fact prompt', err);
      }

      let prompt: string;
      if (trackPrompt) {
        prompt = trackPrompt
          .replace('{track}', trackName)
          .replace('{artist}', artistName ?? '');
      } else {
        prompt = `Give me a true, lesser-known fun fact about the song "${trackName}"${artistName ? ` by ${artistName}` : ''}. Limit to 150 characters and cite the source in parentheses.`;
      }

      const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
      let fact = `${trackName} is awesome!`;
      if (OPENAI_API_KEY) {
        try {
          const resp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
            body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: prompt }], max_tokens: 60, temperature: 0.7 }),
          });
          const json = (await resp.json()) as any;
          fact = json.choices?.[0]?.message?.content?.trim() || fact;
        } catch (err) {
          console.error('[wrap_track] OpenAI error', err);
        }
      }

      return res.status(200).json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: fact, flags: 64 },
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