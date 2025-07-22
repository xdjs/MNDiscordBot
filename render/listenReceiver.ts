import 'dotenv/config';
import express from 'express';
import { REST, Routes } from 'discord.js';
import {
  Client as DiscordClient,
  GatewayIntentBits,
  ActivityType,
  Message,
} from 'discord.js';

// ---------- Profile card generation ----------
import { Canvas, loadImage } from 'skia-canvas';
import { supabase } from '../api/lib/supabase.js';
import { spotifyClientId, spotifyClientSecret } from '../api/lib/spotify.js';

// ---- Helper to PATCH original interaction and log response ----
// Send follow-up message to the interaction webhook so Discord pushes a new message event.
// Using ?wait=true lets us log status/body for debugging.
async function patchOriginal(appId: string, token: string, body: any, tag = 'follow') {
  try {
    const resp = await fetch(`https://discord.com/api/v10/webhooks/${appId}/${token}?wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const text = await resp.text().catch(() => '');
    console.log(`[${tag}] status`, resp.status, text.slice(0, 200));
  } catch (err) {
    console.error(`[${tag}] fetch error`, err);
  }
}

// ---- In-memory session tracking ----
interface ListenSession {
  channelId: string;
  guildId: string;
  /**
   * The last Spotify track identifier we responded to.
   * Prefer the Spotify `syncId` (unique per track) and fall back to the track title when unavailable.
   */
  lastTrackId: string | null;
  factCount: number;
  /** Timer that ends the session after inactivity */
  timeout?: NodeJS.Timeout;
}

const sessions = new Map<string, ListenSession>(); // key = userId

// ---- Chat session tracking ----
const chatChannels = new Set<string>();
interface ChatSession {
  timeout: NodeJS.Timeout;
}
const chatSessions = new Map<string, ChatSession>(); // key = channelId

// ---- Music bot now-playing tracking ----
interface MusicSession {
  botId: string;
  timeout: NodeJS.Timeout;
  factCount: number;
}
const musicSessions = new Map<string, MusicSession>(); // key = channelId

// ---- Listen session timeout helper ----
function scheduleListenTimeout(userId: string) {
  const session = sessions.get(userId);
  if (!session) return;

  // Clear any existing timer
  if (session.timeout) clearTimeout(session.timeout);

  const timeout = setTimeout(async () => {
    // Remove session record
    sessions.delete(userId);

    // Notify channel that the session closed
    try {
      await rest.post(Routes.channelMessages(session.channelId), {
        body: { content: '⌛ Listening session closed due to inactivity.' },
      });
    } catch (err) {
      console.error('Failed to post listen timeout message', err);
    }

    console.log(`Listen session for user ${userId} closed due to inactivity.`);
  }, 10 * 60 * 1000); // 10 minutes

  session.timeout = timeout;
}

function scheduleMusicTimeout(channelId: string) {
  const session = musicSessions.get(channelId);
  if (!session) return;
  clearTimeout(session.timeout);
  const timeout = setTimeout(() => {
    musicSessions.delete(channelId);
    console.log(`Music session for ${channelId} closed due to inactivity.`);
  }, 2 * 60 * 1000);
  session.timeout = timeout;
}

function scheduleChatTimeout(channelId: string) {
  // Clear existing timer if present
  const existing = chatSessions.get(channelId);
  if (existing) {
    clearTimeout(existing.timeout);
  }

  const timeout = setTimeout(async () => {
    chatChannels.delete(channelId);
    chatSessions.delete(channelId);
    try {
      const chan = await client.channels.fetch(channelId);
      if (chan && chan.isTextBased()) {
        await (chan as any).send('⌛ Chat session closed due to inactivity.');
      }
    } catch (err) {
      console.error('Failed to post timeout message', err);
    }
    console.log(`Chat session for ${channelId} closed after inactivity.`);
  }, 2 * 60 * 1000); // 2 minutes

  chatSessions.set(channelId, { timeout });
}

// ---- OpenAI helper ----
const { OPENAI_API_KEY } = process.env;

async function getFunFact(artist: string, track?: string): Promise<string> {
  if (!OPENAI_API_KEY) return `${artist} is cool!`;

  let prompt: string;
  if (track) {
    prompt = `Give me a true, lesser-known, behind-the-scenes fun fact about the song "${track}" by ${artist} ` +
      `(this may include anime openings/endings or songs in any language). ` +
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

// ---- OpenAI helper for general chat ----

// ---- OpenAI helper for "now playing" lines from music bots ----
async function getSongFunFact(nowPlayingLine: string): Promise<string> {
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

interface SongContext {
  track: string;
  artist: string;
}

async function getChatAnswer(question: string, song?: SongContext): Promise<string> {
  if (!OPENAI_API_KEY) return "I'm offline right now. Try again later!";

  let prompt = `You are a helpful assistant in a Discord channel.`;
  if (song) {
    prompt += ` The user is currently listening to the song "${song.track}" by "${song.artist}". Use this information as context when relevant.`;
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

const {
  PORT = '8080',
  DISCORD_BOT_TOKEN,
} = process.env;

if (!DISCORD_BOT_TOKEN) {
  throw new Error('DISCORD_BOT_TOKEN is required');
}

const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);

const client = new DiscordClient({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let ready = false;
client.once('ready', () => {
  console.log(`Discord presence client ready as ${client.user?.tag}`);
  ready = true;
});
client.login(DISCORD_BOT_TOKEN);

// Utility to wait until client ready
async function ensureReady() {
  if (ready) return;
  await new Promise((res) => client.once('ready', res));
}

const app = express();
app.use(express.json());

app.get('/_health', (_, res) => res.send('ok'));

app.post('/listen-hook', async (req, res) => {
  const { user_id: userId, channel_id: channelId, guild_id: guildId } = req.body as {
    user_id?: string;
    channel_id?: string;
    guild_id?: string;
  };

  if (!userId || !channelId || !guildId) {
    return res.status(400).json({ error: 'Missing user_id, channel_id, or guild_id' });
  }

  try {
    await ensureReady();

    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId);
    const hasSpotify = member.presence?.activities.some(
      (a) => a.type === ActivityType.Listening && a.name === 'Spotify'
    );

    if (!hasSpotify) {
      await rest.post(Routes.channelMessages(channelId), {
        body: {
          content:
            `<@${userId}>, please enable "Display current activity as a status message" in your Discord settings so I can detect your Spotify activity. If you do have it enabled then please play a song and try again.`,
        },
      });
      return res.json({ status: 'no-spotify' });
    }


    // Proceed if Spotify activity present – grab artist and send fun fact

    const spotifyAct = member.presence?.activities.find(
      (a) => a.type === ActivityType.Listening && a.name === 'Spotify',
    );

    let artistText =
      spotifyAct?.state ||
      spotifyAct?.assets?.largeText?.split(' – ')[0] ||   // "Artist – Track"
      spotifyAct?.details;                                // track title as last resort

    console.log('artistText extracted:', artistText);
    if (artistText) {
      artistText = artistText
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .join(', ');
    }
    if (!artistText) artistText = 'Unknown artist';
    const trackTitle = spotifyAct?.details || undefined;
    const fact = await getFunFact(artistText as string, trackTitle);

    await rest.post(Routes.channelMessages(channelId), {
      body: {
        content: `🎶 ${fact}`,
      },
    });

    // Start active session tracking for up to 3 songs
    sessions.set(userId, {
      channelId,
      guildId,
      lastTrackId: (spotifyAct as any)?.syncId ?? spotifyAct?.details ?? null,
      factCount: 1,
      timeout: undefined,
    });

    // Start inactivity timer
    scheduleListenTimeout(userId);

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Failed to process listen hook', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---- Chat hook to activate listening on a channel ----
app.post('/chat-hook', (req, res) => {
  const { channel_id: channelId } = req.body as { channel_id?: string };
  if (!channelId) return res.status(400).json({ error: 'Missing channel_id' });

  chatChannels.add(channelId);
  console.log('Chat listening activated for', channelId);
  scheduleChatTimeout(channelId);
  return res.json({ status: 'ok' });
});

// ---- Music hook to track "now playing" messages from a specific bot ----
app.post('/music-hook', (req, res) => {
  const { channel_id: channelId, bot_id: botId } = req.body as {
    channel_id?: string;
    bot_id?: string;
  };
  if (!channelId || !botId) return res.status(400).json({ error: 'Missing channel_id or bot_id' });

  // Clear existing timer if any and set new session
  const existing = musicSessions.get(channelId);
  if (existing) clearTimeout(existing.timeout);

  const timeout = setTimeout(() => {
    musicSessions.delete(channelId);
    console.log(`Music session for ${channelId} closed due to inactivity.`);
  }, 2 * 60 * 1000);

  musicSessions.set(channelId, { botId, timeout, factCount: 0 });
  console.log('Music listening activated for', channelId, 'bot', botId);
  return res.json({ status: 'ok' });
});

// ---------- Profile card generation ----------
app.post('/profile-hook', async (req, res) => {
  console.log('[profile-hook] hit', new Date().toISOString());

  const {
    user_id: userId,
    username,
    avatar,
    application_id: appId,
    interaction_token: token,
  } = req.body as {
    user_id?: string;
    username?: string;
    avatar?: string;
    application_id?: string;
    interaction_token?: string;
  };

  // Optional shared-secret check
  const secret = process.env.PROFILE_HOOK_SECRET;
  if (secret && req.get('x-profile-signature') !== secret) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  console.log('[profile-hook] app', appId);
  console.log('[profile-hook] received token', (token ?? '').slice(0, 8) + '…', 'len', (token ?? '').length);

  if (!userId || !appId || !token) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const avatarUrl = `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png?size=256`;

  // --- Reuse cached card if avatar hasn't changed ---
  let bgUrl: string | null = null;
  let bgImg: any = null;
  try {
    const { data: existing } = await supabase
      .from('profiles')
      .select('card_url, avatar_url, bg_image_url')
      .eq('user_id', userId)
      .single();

    bgUrl = existing?.bg_image_url || null;

    if (existing?.card_url && existing.avatar_url === avatarUrl && bgUrl === existing.bg_image_url) {
      // Send embed with cached image URL and exit early
      await patchOriginal(appId, token, { embeds: [{ image: { url: existing.card_url } }] });

      return res.json({ status: 'cached' });
    }
  } catch (cacheErr) {
    console.error('[profile-hook] cache lookup error', cacheErr);
    // fall through to regenerate
  }

  // If bg image set, load it
  if (typeof bgUrl === 'string') {
    try {
      bgImg = await loadImage(bgUrl);
    } catch (err) {
      console.error('[profile-hook] Failed to load bg image', err);
    }
  }

  // Build card
  const width = 550;
  const height = 160;
  const canvas = new Canvas(width, height);
  const ctx: any = canvas.getContext('2d');

  const roundRect = (ctx: any, x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.fill();
  };

  // Background
  if (bgImg) {
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, 0, 0, width, height, 18);
    ctx.clip();
    ctx.drawImage(bgImg, 0, 0, width, height);
    ctx.restore();
  } else {
    ctx.fillStyle = '#1e1e1e';
    roundRect(ctx, 0, 0, width, height, 18);
  }

  // Avatar drawing
  const avatarSize = 116;
  const avatarX = 22;
  const avatarY = (height - avatarSize) / 2;
  try {
    const img = await loadImage(avatarUrl);
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, avatarX, avatarY, avatarSize, avatarSize);
    ctx.restore();
  } catch (err) {
    console.error('[profile-hook] Avatar load error', err);
  }

  // Status circle
  ctx.fillStyle = '#3ba55d';
  const dotR = 12;
  ctx.beginPath();
  ctx.arc(avatarX + avatarSize - dotR, avatarY + avatarSize - dotR, dotR, 0, Math.PI * 2);
  ctx.fill();

  // Username text
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 42px Sans';
  ctx.textBaseline = 'middle';
  ctx.fillText(username ?? 'Unknown', avatarX + avatarSize + 30, height / 2);

  const buffer: Buffer = await (canvas as any).png;

  // --- Upload card to Supabase Storage ---
  let cardUrl: string | null = null;
  try {
    const filePath = `cards/${userId}-${Date.now()}.png`; // unique filename to bust Discord cache
    await supabase.storage
      .from('profile-cards')
      .upload(filePath, buffer, { upsert: false, contentType: 'image/png' });

    const { data } = supabase.storage.from('profile-cards').getPublicUrl(filePath);
    cardUrl = data.publicUrl;
  } catch (uploadErr) {
    console.error('[profile-hook] card upload error', uploadErr);
  }

  // Fallback: if upload failed, skip sending
  if (!cardUrl) {
    return res.status(500).json({ error: 'Failed to upload card' });
  }

  // Send follow-up message via embed
  try {
    await patchOriginal(appId, token, { embeds: [{ image: { url: cardUrl } }] });
  } catch (err) {
    console.error('[profile-hook] Failed to send embed', err);
  }

  // Upsert profile row with new card_url
  (async () => {
    try {
      await supabase.from('profiles').upsert({
        user_id: userId,
        username: username ?? '',
        avatar_url: avatarUrl,
        bg_image_url: bgUrl,
        card_url: cardUrl,
        updated_at: new Date().toISOString(),
      });
    } catch (e: any) {
      console.error('[profile-hook] Supabase upsert error', e);
    }
  })();

  res.json({ status: 'queued' });
});

// ---------- Image generation ----------
app.post('/image-hook', async (req, res) => {
  console.log('[image-hook] hit', new Date().toISOString());

  const {
    user_id: userId,
    application_id: appId,
    interaction_token: token,
  } = req.body as {
    user_id?: string;
    application_id?: string;
    interaction_token?: string;
  };

  // Optional shared-secret check
  const secret = process.env.IMAGE_HOOK_SECRET;
  if (secret && req.get('x-image-signature') !== secret) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  console.log('[image-hook] app', appId);
  console.log('[image-hook] received token', (token ?? '').slice(0, 8) + '…', 'len', (token ?? '').length);

  if (!userId || !appId || !token) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const fetchTopTracks = (accessToken: string) =>
    fetch('https://api.spotify.com/v1/me/top/tracks?limit=10&time_range=medium_term', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

  const refreshSpotifyToken = async (refreshToken: string) => {
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refreshToken);

    const basic = Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString('base64');
    const resp = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    if (!resp.ok) throw new Error('Failed to refresh');
    return resp.json() as Promise<{ access_token: string }>;
  };

  try {
    // Fetch Spotify tokens
    const { data, error } = await supabase
      .from('spotify_tokens')
      .select('access_token, refresh_token')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) {
      await patchOriginal(appId, token, {
        content: "You haven't connected your Spotify account yet. Use /connect first!",
      });
      return res.json({ status: 'no_spotify' });
    }

    let { access_token: accessToken, refresh_token: refreshToken } = data as any;
    let topRes = await fetchTopTracks(accessToken);

    if (topRes.status === 401 && refreshToken) {
      try {
        const refreshed = await refreshSpotifyToken(refreshToken);
        accessToken = refreshed.access_token;
        await supabase
          .from('spotify_tokens')
          .update({ access_token: accessToken, updated_at: new Date().toISOString() })
          .eq('user_id', userId);
        topRes = await fetchTopTracks(accessToken);
      } catch {
        /* ignore */
      }
    }

    if (!topRes.ok) {
      await patchOriginal(appId, token, { content: 'Failed to fetch your top tracks. Please try again later.' });
      return res.json({ status: 'spotify_fail' });
    }

    // --- Check cache ---
    try {
      const { data: existingImg } = await supabase
        .from('track_images')
        .select('image_url')
        .eq('user_id', userId)
        .maybeSingle();

      if (existingImg?.image_url) {
        await patchOriginal(appId, token, { embeds: [{ image: { url: existingImg.image_url } }] });
        return res.json({ status: 'cached' });
      }
    } catch (cacheErr) {
      console.error('[image-hook] cache lookup error', cacheErr);
    }

    const json = await topRes.json();
    const tracksArray: string[] = json.items.map(
      (t: any, i: number) => `${i + 1}. ${t.name} – ${t.artists.map((a: any) => a.name).join(', ')}`,
    );
    const prompt =
      `Create a cohesive, high-quality personlized picture of someone (a person listening in their room) listening to the following songs:\n` +
      tracksArray.join('\n') +
      `\nDo not include any text in the image, other than the song/artist names that could be on posters, cds, etc.`;

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');

    const imgRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ prompt, n: 1, size: '1024x1024', model: 'dall-e-3' }),
    });

    if (!imgRes.ok) {
      await patchOriginal(appId, token, { content: 'Failed to generate image. Please try again later.' });
      return res.json({ status: 'openai_fail' });
    }

    const imgJson = await imgRes.json();
    const imageUrlRemote = imgJson.data?.[0]?.url;

    if (!imageUrlRemote) {
      await patchOriginal(appId, token, { content: 'Image generation returned no result.' });
      return res.json({ status: 'no_image' });
    }

    // --- Persist image to Supabase Storage ---
    let finalUrl = imageUrlRemote;
    try {
      const resp = await fetch(imageUrlRemote);
      const buf = Buffer.from(await resp.arrayBuffer());
      const filePath = `top_tracks/${userId}.png`;
      await supabase.storage
        .from('track-images')
        .upload(filePath, buf, { upsert: true, contentType: 'image/png' });

      const { data: pub } = supabase.storage.from('track-images').getPublicUrl(filePath);
      if (pub?.publicUrl) {
        finalUrl = pub.publicUrl;
      }
    } catch (uploadErr) {
      console.error('[image-hook] image upload error', uploadErr);
    }

    // Send embed
    await patchOriginal(appId, token, { embeds: [{ image: { url: finalUrl } }] });

    // Cache record in DB (fire-and-forget)
    (async () => {
      try {
        await supabase.from('track_images').upsert({
          user_id: userId,
          image_url: finalUrl,
          updated_at: new Date().toISOString(),
        });
      } catch (err) {
        console.error('[image-hook] upsert error', err);
      }
    })();

    return res.json({ status: 'done' });
  } catch (err) {
    console.error('[image-hook] error', err);
    return res.status(500).json({ error: 'internal' });
  }
});

// ---- Presence listener to push fun facts on song change ----
client.on('presenceUpdate', async (oldPresence, newPresence) => {
  const userId = newPresence.userId;
  const session = sessions.get(userId);
  if (!session) return; // not actively listening

  const spotifyAct = newPresence.activities.find(
    (a) => a.type === ActivityType.Listening && a.name === 'Spotify',
  );

  // Reset inactivity timer if the user is still listening
  if (spotifyAct) {
    scheduleListenTimeout(userId);
  }

  if (!spotifyAct) return; // user stopped listening; keep session until timeout or manual stop

  const trackIdentifier = (spotifyAct as any).syncId ?? spotifyAct.details ?? '';
  if (!trackIdentifier || trackIdentifier === session.lastTrackId) return; // same song

  // New song detected
  const artistTextRaw = spotifyAct.state || spotifyAct.assets?.largeText?.split(' – ')[0] || '';
  const artistText =
    artistTextRaw
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(', ') ||
    'Unknown artist';

  // Update session state
  session.lastTrackId = trackIdentifier;
  session.factCount += 1;

  const trackTitle = spotifyAct.details || undefined;
  const fact = await getFunFact(artistText as string, trackTitle);

  try {
    await rest.post(Routes.channelMessages(session.channelId), {
      body: {
        content: `🎶 ${fact}`,
      },
    });
  } catch (err) {
    console.error('Failed to post fun fact', err);
  }

  if (session.factCount >= 10) {
    if (session.timeout) clearTimeout(session.timeout);
    sessions.delete(userId);
  }
});

// ---- Message listener for #bot-chat ----
client.on('messageCreate', async (message: Message) => {
  // Ignore messages sent by *this* bot to prevent feedback loops.
  if (message.author.id === client.user?.id) return;

  // -----------------------------
  // Music bot "now playing" flow
  // -----------------------------
  const musicSession = musicSessions.get(message.channel.id);
  if (musicSession && message.author.id === musicSession.botId) {
    const npMatch = /now\s*playing[:]?\s*(.+)/i.exec(message.content);
    if (npMatch && npMatch[1]) {
      const nowPlayingLine = npMatch[1].trim();
      const fact = await getSongFunFact(nowPlayingLine);

      // Increment fact count and reset inactivity timer
      musicSession.factCount += 1;
      scheduleMusicTimeout(message.channel.id);

      // End session after 3 fun facts
      if (musicSession.factCount >= 3) {
        if (musicSession.timeout) clearTimeout(musicSession.timeout);
        musicSessions.delete(message.channel.id);
        console.log(`Music session for ${message.channel.id} closed after 3 fun facts.`);
      }

      // Determine destination: prefer the voice channel the music bot is currently in
      let destChannelId = message.channel.id; // default to current text channel
      if (message.guild) {
        try {
          const botMember = await message.guild.members.fetch(message.author.id);
          const voiceChan = botMember.voice?.channel;
          if (voiceChan) {
            destChannelId = voiceChan.id;
          }
        } catch (err) {
          console.error('Failed to resolve bot voice channel', err);
        }
      }

      try {
        await rest.post(Routes.channelMessages(destChannelId), {
          body: { content: `🎶 ${fact}` },
        });
      } catch (err) {
        console.error('Failed to send song fact', err);
      }
    }
    return; // Do not run chat answer flow
  }

  // ------------------------------------
  // Chat Q&A flow for channels in chatChannels
  // ------------------------------------
  if (!chatChannels.has(message.channel.id)) return;

  if (message.author.bot) return; // ignore other bots in chat Q&A

  // Attempt to include current Spotify song context if author is listening
  let songCtx: SongContext | undefined;
  const activities = message.member?.presence?.activities || [];
  const spotifyAct = activities.find((a) => a.type === ActivityType.Listening && a.name === 'Spotify');
  if (spotifyAct) {
    const track = spotifyAct.details || '';
    let artist = spotifyAct.state || '';
    if (!artist) {
      const largeText = spotifyAct.assets?.largeText as string | undefined;
      if (largeText && largeText.includes(' – ')) {
        artist = largeText.split(' – ')[0];
      }
    }
    if (track && artist) {
      songCtx = { track, artist };
    }
  }

  const answer = await getChatAnswer(message.content, songCtx);

  // Reset inactivity timer
  scheduleChatTimeout(message.channel.id);

  try {
    if (message.channel.isTextBased()) {
      await (message.channel as any).send({ content: answer });
    }
  } catch (err) {
    console.error('Failed to send chat answer', err);
  }
});

app.get('/', (_, res) => {
  res.send('Listen Receiver up');
});

app.listen(parseInt(PORT, 10), () => {
  console.log(`Listen receiver running on port ${PORT}`);
}); 