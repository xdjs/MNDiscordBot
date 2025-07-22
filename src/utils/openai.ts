import 'dotenv/config';
import { fetchArtistLinksByName } from '../services/artistLinks.js';

export interface SongContext {
  track: string;
  artist: string;
}

const { OPENAI_API_KEY } = process.env;

// Fun fact based on artist and optional track title, enriched with DB social links.
export async function getFunFact(artist: string, track?: string): Promise<string> {
  if (!OPENAI_API_KEY) return `${artist} is cool!`;

  // Pull social links from our artists DB
  const links = await fetchArtistLinksByName(artist);
  const socialFields = links ? (({ youtube, tiktok, x, instagram }) => ({ youtube, tiktok, x, instagram }))(links) : null;
  const hasContext = socialFields && Object.values(socialFields).some((v) => v && v.toString().trim().length > 0);

  let socialCtx = '';
  if (hasContext && links) {
    const parts = Object.entries(socialFields!)
      .filter(([_, url]) => url)
      .map(([platform, url]) => `${platform}: ${url}`);
    if (parts.length) {
      socialCtx = `Verified social links:\n${parts.join('\n')}\n\n`;
    }
  }

  const basePrompt = track
    ? `Give me a true, lesser-known fun fact about the song "${track}" OR its credited artist(s) (${artist})
    (If you cannot find anything about the song, then share a fun fact about the credited artist(s)). `
    : `Give me a true, lesser-known fun fact about the artist ${artist}. `;

  const prompt =
    socialCtx +
    basePrompt +
    'Limit to 150 characters and cite the source or context in parentheses. Do NOT fabricate information.';

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

  // If missing context, append footer encouraging DB addition
  if (!hasContext) {
    const baseUrl = process.env.BASE_URL || 'https://your-site.com/add-artist';

    let footerMsg: string;
    let link: string;

    if (!links) {
      // Artist not in DB at all
      link = baseUrl;
      footerMsg = 'Our DB doesn’t yet include this artist — adding them helps reduce hallucinations:';
    } else {
      // Artist exists but lacks social information
      link = `${baseUrl}/artist/${links.id}`;
      footerMsg = "Our DB doesn't have enough information — adding more helps reduce hallucinations:";
    }

    fact += `\n\n*${footerMsg}* ${link}`;
  }

  return fact;
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