import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyKey, InteractionType, InteractionResponseType } from 'discord-interactions';
import 'dotenv/config';
import { help } from './commands/help.js';
import { eavesdrop } from './commands/eavesdrop.js';
import { nerdout } from './commands/nerdout.js';
import { wrap as wrapCommand } from './commands/wrap.js';
import { update as updateCommand } from './commands/update.js';
import { unwrap as unwrapCommand } from './commands/unwrap.js';
import { settime } from './commands/settime.js';
import { buildWrapPayload } from '../src/utils/wrapPaginator.js';
import { fetchArtistLinksByName } from '../src/services/artistLinks.js';
import { supabase } from './lib/supabase.js';

// Helper function to get random emoji for buttons
async function pickRandomEmoji(): Promise<string> {
  try {
    const { data, error } = await supabase
      .from('Summary_prompts')
      .select('emoji')
      .limit(1)
      .single();

    if (error || !data) return '🔎'; // fallback to magnifying glass

    const emojis = (data.emoji as string[]) ?? [];
    if (!Array.isArray(emojis) || emojis.length === 0) return '🔎';

    return emojis[Math.floor(Math.random() * emojis.length)];
  } catch (err) {
    console.error('[pickRandomEmoji] failed to load emojis', err);
    return '🔎'; // fallback to magnifying glass
  }
}

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

      case 'nerdout':
        response = await nerdout(interaction);
        break;

      case 'eavesdrop':
        response = await eavesdrop(interaction);
        break;
      case 'help':
        response = await help(callerId);
        break;

      case 'wrap':
        response = await wrapCommand(interaction);
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
      // Parse arrow ID: wrap_prev_<date?>_<page>
      //Date to correct page info 
      const parts = custom.split('_');
      const direction = parts[1] === 'prev' ? -1 : 1;
      let dateParam: string | undefined;
      let currentPage = 0;
      if (parts.length === 4) {
        // wrap_prev_YYYY-MM-DD_page
        dateParam = parts[2];
        currentPage = parseInt(parts[3], 10);
      } else if (parts.length === 3) {
        // Legacy format: wrap_prev_page
        currentPage = parseInt(parts[2], 10);
      }
      const newPage = currentPage + direction;
      const guildId = interaction.guild_id;

      // Determine embed type to use appropriate snapshot
      const origEmbed = (interaction as any).message?.embeds?.[0] as any | undefined;
      const isTrackEmbed = origEmbed?.title?.includes('Top Tracks');
      const isArtistEmbed = origEmbed?.title?.includes('Top Artists');
      
      // Fetch appropriate snapshot based on embed type
      let data: any[] | null = null;
      
      if (isArtistEmbed) {
        // Try new artist-specific snapshot first
        const snapRes = await supabase.from('wrap_guilds').select('wrap_artists').eq('guild_id', guildId).maybeSingle();
        if (snapRes.data?.wrap_artists && Array.isArray(snapRes.data.wrap_artists)) {
          data = snapRes.data.wrap_artists;
        }
      } else if (isTrackEmbed) {
        // Try new track-specific snapshot first
        const snapRes = await supabase.from('wrap_guilds').select('wrap_tracks').eq('guild_id', guildId).maybeSingle();
        if (snapRes.data?.wrap_tracks && Array.isArray(snapRes.data.wrap_tracks)) {
          data = snapRes.data.wrap_tracks;
        }
      }
      
      // Fallback to wrap_up for both old and new embeds if specific snapshot not found
      if (!data) {
        const snapRes = await supabase.from('wrap_guilds').select('wrap_up').eq('guild_id', guildId).maybeSingle();
        if (snapRes.data?.wrap_up && Array.isArray(snapRes.data.wrap_up)) {
          // Check if wrap_up contains historical data (new format) or legacy data (old format)
          const wrapUpData = snapRes.data.wrap_up;
          
          if (wrapUpData.length > 0 && wrapUpData[0].date) {
            // New historical format - try to find data from the embed's creation date
            // For now, use the most recent entry as fallback
            // TODO: We could extract embed timestamp to find exact historical match
            const mostRecent = wrapUpData[wrapUpData.length - 1];
            data = mostRecent?.data || [];
          } else {
            // Legacy format - direct array of user data
            data = wrapUpData;
          }
        }
      }
      
      if (!data) {
        // Final fallback to current user_tracks – happens if no snapshot stored yet
        const res = await supabase
          .from('user_tracks')
          .select('user_id, top_track, top_artist')
          .eq('guild_id', guildId);
        data = res.data as any[];
      }

      // Filter out rows based on embed type
      let rows: any[];
      if (isArtistEmbed) {
        rows = Array.isArray(data) ? data.filter((r) => r.top_artist !== null) : [];
      } else if (isTrackEmbed) {
        rows = Array.isArray(data) ? data.filter((r) => r.top_track !== null) : [];
      } else {
        // Legacy combined format
        rows = Array.isArray(data) ? data.filter((r) => r.top_track !== null || r.top_artist !== null) : [];
      }

      // Generate lines based on embed type
      let lines: string[];
      if (isArtistEmbed) {
        lines = rows.map((row) => {
          const userMention = `<@${row.user_id}>`;
          return `${userMention} — 🎤 **Artist:** ${row.top_artist ?? 'N/A'}`;
        });
      } else if (isTrackEmbed) {
        lines = rows.map((row:any) => {
          const userMention = `<@${row.user_id}>`;
          const url = row.spotify_track_id ? `https://open.spotify.com/track/${row.spotify_track_id}` : null;
          const display = url ? `[${row.top_track ?? 'N/A'}](${url})` : (row.top_track ?? 'N/A');
          return `${userMention} — 🎵 **Track:** ${display}`;
        });
      } else {
        // Legacy combined format -- used for old embeds before 2025-08-06
        lines = rows.map((row) => {
          const userMention = `<@${row.user_id}>`;
          return `${userMention} — 🎵 **Track:** ${row.top_track ?? 'N/A'} | 🎤 **Artist:** ${row.top_artist ?? 'N/A'}`;
        });
      }

      const userRowsPage = rows.slice(newPage * 5, newPage * 5 + 5);

      // Preserve the original summary prompt, blank line separator, and accent colour from the
      // original embed so that every paginated view looks identical.
      const origDescLines = origEmbed?.description ? (origEmbed.description as string).split('\n') : [];
      const headerLines = origDescLines.slice(0, 2); // summary prompt + blank line
      const accent = origEmbed?.color;

      // Build the full list with the preserved header so the summary is always present.
      const allLines = [...headerLines, ...lines];

      // Determine embed type for buildWrapPayload
      let embedType: 'artist' | 'track' | 'legacy' = 'legacy';
      if (isArtistEmbed) {
        embedType = 'artist';
      } else if (isTrackEmbed) {
        embedType = 'track';
      }

      let payload = buildWrapPayload(allLines, newPage, origEmbed?.title ?? 'Daily Wrap', userRowsPage, accent, embedType, dateParam);
      
      // Add random emojis to button labels (buttons are already correctly generated)
      if (payload.components) {
        for (const row of payload.components) {
          if (row.components) {
            for (const c of row.components) {
              if (typeof c.label === 'string' && !c.label.includes('🔎')) {
                const randomEmoji = await pickRandomEmoji();
                c.label = `${c.label} ${randomEmoji}`;
              }
            }
          }
        }
      }

      return res.status(200).json({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: payload,
      });
    }

    // --------Direct artist bio buttons --------
    if (custom.startsWith('wrap_artist_')) {
      const artistName = custom.replace('wrap_artist_', '');
      
      if (!artistName) {
        return res.status(200).json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `No artist information available.`,
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

    // --------Legacy user ID-based artist bio buttons (fallback) -------- **ONLY DELETE AFTER A WEEK**
    if (custom.startsWith('wrap_pick_')) {
      const userId = custom.replace('wrap_pick_', '');



      // Fetch artist from snapshot - try current data first, then historical
      let artistName: string | undefined;
      
      // First try wrap_artists (current day data)
      const currentSnap = await supabase.from('wrap_guilds').select('wrap_artists').eq('guild_id', interaction.guild_id).maybeSingle();
      if (currentSnap.data?.wrap_artists && Array.isArray(currentSnap.data.wrap_artists)) {
        const match = currentSnap.data.wrap_artists.find((r: any) => r.user_id === userId);
        artistName = match?.top_artist;
      }
      
      // If not found in current data, try historical wrap_up
      if (!artistName) {
        const snap = await supabase.from('wrap_guilds').select('wrap_up').eq('guild_id', interaction.guild_id).maybeSingle();
        if (snap.data?.wrap_up && Array.isArray(snap.data.wrap_up)) {
          const wrapUpData = snap.data.wrap_up;
          
          if (wrapUpData.length > 0 && wrapUpData[0].date) {
            // New historical format - use most recent historical data
            const mostRecent = wrapUpData[wrapUpData.length - 1];
            const match = mostRecent?.data?.find((r: any) => r.user_id === userId);
            artistName = match?.top_artist;
          } else {
            // Legacy format
            const match = wrapUpData.find((r: any) => r.user_id === userId);
            artistName = match?.top_artist;
          }
        }
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

     // ^^^^^^^^^^^^^^Legacy user ID-based track bio buttons (fallback) ^^^^^^^^^^^^**ONLY DELETE AFTER A WEEK**^^^^^^^^^

    // ---- Direct track fact buttons ----
    if (custom.startsWith('wrap_track_')) {
      let trackName: string | undefined;
      let artistName: string | undefined;
      
      // Check if this is the new direct format (contains track name) vs old user ID format
      const customIdContent = custom.replace('wrap_track_', '');
      if (customIdContent.startsWith('user_')) {
        // This is the old user-based format, skip to legacy handler below
      } else {
        // This is the new direct track name format
        trackName = customIdContent;
        
        if (!trackName) {
          return res.status(200).json({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: `No track information available.`, flags: 64 },
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
          prompt = `Give me a true, lesser-known fun fact about the song "${trackName}"${artistName ? ` by ${artistName}` : ''}. Limit to 150 characters.`;
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

    // ---- Legacy track fact buttons (user ID based) ---- **ONLY DELETE AFTER A WEEK**
    if (custom.startsWith('wrap_track_user_') || (custom.startsWith('wrap_track_') && custom.replace('wrap_track_', '').startsWith('user_'))) {
      const userId = custom.replace('wrap_track_', '');

      // Fetch track & artist from snapshot - try current data first, then historical
      let trackName: string | undefined;
      let artistName: string | undefined;
      
      // First try wrap_tracks (current day data)
      const currentSnap = await supabase.from('wrap_guilds').select('wrap_tracks').eq('guild_id', interaction.guild_id).maybeSingle();
      if (currentSnap.data?.wrap_tracks && Array.isArray(currentSnap.data.wrap_tracks)) {
        const match = currentSnap.data.wrap_tracks.find((r: any) => r.user_id === userId);
        trackName = match?.top_track;
        artistName = match?.top_artist;
      }
      
      // If not found in current data, try historical wrap_up
      if (!trackName) {
        const snap = await supabase
          .from('wrap_guilds')
          .select('wrap_up')
          .eq('guild_id', interaction.guild_id)
          .maybeSingle();
        if (snap.data?.wrap_up && Array.isArray(snap.data.wrap_up)) {
          const wrapUpData = snap.data.wrap_up;
          
          if (wrapUpData.length > 0 && wrapUpData[0].date) {
            // New historical format - use most recent historical data
            const mostRecent = wrapUpData[wrapUpData.length - 1];
            const match = mostRecent?.data?.find((r: any) => r.user_id === userId);
            trackName = match?.top_track;
            artistName = match?.top_artist;
          } else {
            // Legacy format
            const match = wrapUpData.find((r: any) => r.user_id === userId);
            trackName = match?.top_track;
            artistName = match?.top_artist;
          }
        }
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
    // ^^^^^^^^^^^^^^Legacy track fact buttons (user ID based) ^^^^^^^^^^^^**ONLY DELETE AFTER A WEEK**^^^^^^^^^
  }

  res.status(400).send('Unhandled interaction type');
}

export const config = {
  api: {
    bodyParser: false,
  },
}; 