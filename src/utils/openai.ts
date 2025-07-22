import 'dotenv/config';

export interface SongContext {
  track: string;
  artist: string;
}

const { OPENAI_API_KEY } = process.env;

// Fun fact based on artist and optional track title
export async function getFunFact(artist: string, track?: string): Promise<string> {
  if (!OPENAI_API_KEY) return `${artist} is cool!`;

  let prompt: string;
  if (track) {
    prompt = `Give me a true, lesser-known, behind-the-scenes fun fact about the song "${track}" by ${artist} ` +
      `(this may include songs in any language, if you cannot find anything then share a fun fact about the credited artist(s)). ` +
      `OR share a fun fact about the credited artist(s). ` +
      `Limit to 150 characters and mention the source or context in parentheses. ` +
      `Do NOT fabricate information.`;
  } else {
    prompt = `Give me a true, lesser-known, behind-the-scenes fun fact about the artist(s)/band/group: ${artist}. ` +
      `Keep it under 150 characters, reference the source in parentheses, and do NOT invent facts.`;
  }

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
        max_tokens: 50,
        temperature: 0.7,
      }),
    });

    const json = (await res.json()) as any;
    const fact = json.choices?.[0]?.message?.content?.trim();
    return fact || `${artist} is cool!`;
  } catch (err) {
    console.error('OpenAI error', err);
    return `${artist} is cool!`;
  }
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