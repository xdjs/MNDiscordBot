import 'dotenv/config';
import { fetchArtistLinksByName, ArtistLinks } from '../services/artistLinks.js';

async function generateGenericFactPrompt(artist: string, track?: string): Promise<string> {
  const base = track
    ? `Give me a true, lesser-known fun fact about the song "${track}" OR its credited artist(s) (${artist}). `
    : `Give me a true, lesser-known fun fact about the artist ${artist}. `;

  const prompt =
    base +
    'Limit to 150 characters and cite the source or context in parentheses. Do NOT fabricate information.';

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: prompt }], max_tokens: 60, temperature: 0.7 }),
  });
  const json = (await res.json()) as any;
  return json.choices?.[0]?.message?.content?.trim() || `${artist} is cool!`;
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

  for (const aName of artistNames) {
    const row = await fetchArtistLinksByName(aName);
    lookups.push(row as any);
    if ((row as any)?.skip) continue; // skip when pool busy
    if (row && row.spotify) {
      contextParts.push(`- ${aName}: https://open.spotify.com/artist/${row.spotify}`);
    } else {
      contextParts.push(`- ${aName}: not found`);
    }
  }

  const hasContext = contextParts.some((p) => !p.endsWith('not found'));

  let socialCtx = '';
  socialCtx = `Spotify profiles for the credited artist(s):\n${contextParts.map((p,i)=>`[${i+1}] ${p}`).join('\n')}\n\n`;

  const basePrompt = track
    ? `Give me a true, lesser-known fun fact about the song "${track}" OR its credited artist(s) (${artist})
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

  // Parse leading tag
  let footer = '';
  const tagMatch = /^\s*\[(\d+)]/.exec(fact);
  if (tagMatch) {
    const idx = Number(tagMatch[1]) - 1;
    fact = fact.replace(tagMatch[0], '');
    const rowPicked = lookups[idx] as any;
    if (!rowPicked || rowPicked.skip) {
      // pool skip or no row
      const baseUrl = process.env.BASE_URL || 'https://your-site.com/add-artist';
      footer = `\n\n*Our DB doesn’t yet include this artist — adding them helps reduce hallucinations:* ${baseUrl}`;
    } else if (!rowPicked.spotify) {
      const baseUrl = process.env.BASE_URL || 'https://your-site.com/add-artist';
      footer = `\n\n*Our DB doesn't have enough information about this artist — adding more helps reduce hallucinations:* ${baseUrl}/artist/${rowPicked.id}`;
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

// Fun fact helper for music bot "now playing" lines
export async function getSongFunFact(nowPlayingLine: string): Promise<string> {
  if (!OPENAI_API_KEY) return `${nowPlayingLine} sounds great!`;

  const prompt = `The following Discord message came from a music bot and announces what it is currently playing.\n` +
    `Message: \"${nowPlayingLine}\"\n` +
    `Extract the song (and artist if present) and give me one fun fact about that song in 1-2 sentences. ` +
    `If you cannot identify the song, reply: I'm sorry but I couldn't find anything about that song.`;

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
    const fact = json.choices?.[0]?.message?.content?.trim();
    return fact || `${nowPlayingLine} sounds great!`;
  } catch (err) {
    console.error('OpenAI song fact error', err);
    return `${nowPlayingLine} sounds great!`;
  }
}

// General chat answer helper, with optional current song context
export async function getChatAnswer(question: string, song?: SongContext): Promise<string> {
  if (!OPENAI_API_KEY) return "I'm offline right now. Try again later!";

  let prompt = `You are a helpful assistant in a Discord channel.`;
  if (song) {
    prompt += ` The user is currently listening to the song \"${song.track}\" by \"${song.artist}\". Use this information as context when relevant.`;
  }
  prompt += ` Answer the following question concisely and helpfully. Question: ${question}`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.7,
      }),
    });

    const json = (await res.json()) as any;
    const answer = json.choices?.[0]?.message?.content?.trim();
    return answer || "I'm not sure.";
  } catch (err) {
    console.error('OpenAI chat error', err);
    return "Something went wrong.";
  }
} 