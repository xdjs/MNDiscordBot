import 'dotenv/config';
import { fetchArtistLinksByName, ArtistLinks } from '../services/artistLinks.js';
import { supabase } from '../../api/lib/supabase.js';

// Cache prompts so we don't query DB on every call
let summaryPromptsCache: { fun_fact?: string | null; bot_fact?: string | null } | null = null;


// Pull prompt from the database (returns a non-null object)
async function loadSummaryPrompts(): Promise<{ fun_fact?: string | null; bot_fact?: string | null }> {
  if (summaryPromptsCache) return summaryPromptsCache;
  try {
    const { data } = await supabase
      .from('bot_prompts')
      .select('fun_fact, bot_fact')
      .limit(1)
      .single();
    summaryPromptsCache = data ?? {};
  } catch (err) {
    console.error('[openai] failed to load bot_prompts', err);
    summaryPromptsCache = {};
  }
  return summaryPromptsCache ?? {};
}

export interface SongContext {
  track: string;
  artist: string;
}

const { OPENAI_API_KEY } = process.env;

// Fun fact based on artist and optional track title, enriched with DB social links.
export async function getFunFact(artist: string, track?: string): Promise<string> {
  if (!OPENAI_API_KEY) return `${artist} is cool!`;

  // handle multiple artist names separated by commas or &
  const artistNames = artist.split(/[,&]/).map(s => s.trim()).filter(Boolean);

  const lookups: (ArtistLinks | null | { skip: true })[] = [];
  const contextParts: string[] = [];
  let hasContext = false;

  for (const aName of artistNames) {
    const row = await fetchArtistLinksByName(aName);
    lookups.push(row as any);
    if ((row as any)?.skip) continue; // skip when pool busy
    if (row) {
      const r: any = row;
      const link = r.youtube
        ? r.youtube
        : r.tiktok
        ? r.tiktok
        : r.x
        ? r.x
        : r.instagram ?? null;

      if (link) {
        contextParts.push(`- ${aName}: ${link}`);
        hasContext = true;
      } else {
        contextParts.push(`- ${aName}: not found`);
      }
    } else {
      contextParts.push(`- ${aName}: not found`);
    }
  }

  // already computed

  let socialCtx = '';
  socialCtx = `Spotify profiles for the credited artist(s):\n${contextParts.map((p,i)=>`[${i+1}] ${p}`).join('\n')}\n\n`;

  // Use DB-provided prompt template if available
  const { fun_fact } = await loadSummaryPrompts();
  const basePrompt = fun_fact
    ? fun_fact.replace('{artist}', artist).replace('{track}', track ?? '')
    : track
    ? `Give me a true, lesser-known fun fact about the song "${track}"(it might be in a different language) OR its credited artist(s) (${artist})
    (If you cannot find anything about the song, then share a fun fact about the credited artist(s). 
    If you cannot find anything at all DO NOT SAY "If you have any other questions, feel free to ask!" AT THE END OF YOUR RESPONSE). `
    : `Give me a true, lesser-known fun fact about the artist ${artist}. `;

  const prompt =
    socialCtx +
    basePrompt +
    'Start your answer with the numeric tag for the chosen artist, e.g. [1]. ' +
    'Limit to 150 characters and cite the source or context in parentheses. Do NOT fabricate facts.';

  let fact: string;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 60,
        temperature: 0.7,
      }),
    });

    const json = (await res.json()) as any;
    fact = json.choices?.[0]?.message?.content?.trim() || `${artist} is cool!`;
  } catch (err) {
    console.error('OpenAI error', err);
    fact = `${artist} is cool!`;
  }

  // Parse leading tag for fun fact of multi artist songs
  let footer = '';
  const tagMatch = /^\s*\[(\d+)]/.exec(fact);
  if (tagMatch) {
    const idx = Number(tagMatch[1]) - 1;
    fact = fact.replace(tagMatch[0], '');
    const rowPicked = lookups[idx] as any;
    if (!rowPicked || rowPicked.skip) {
      // pool skip or no row
      const baseUrl = process.env.BASE_URL || 'https://your-site.com/add-artist';
      footer = `\n\n*Our DB doesn’t yet include this artist — adding them helps reduce hallucinations:* ${baseUrl}\n`;
    } else {
      const r:any = rowPicked;
      const hasAny = r.youtube || r.tiktok || r.x || r.instagram;
      if (!hasAny) {
        const baseUrl = process.env.BASE_URL || 'https://your-site.com/add-artist';
        footer = `\n\n*Our DB doesn't have enough information about this artist — adding more helps reduce hallucinations:* ${baseUrl}/artist/${r.id}\n`;
      }
    }
  } else {
    // No tag parsed – fall back footer logic
    if (!hasContext) {
      const baseUrl = process.env.BASE_URL || 'https://your-site.com/add-artist';
      footer = `\n\n*Our DB doesn’t yet include this artist — adding them helps reduce hallucinations:* ${baseUrl}`;
    }
  }

  return fact + footer;
}