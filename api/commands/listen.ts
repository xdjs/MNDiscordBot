import { InteractionResponseType } from 'discord-interactions';
import { supabase } from '../lib/supabase.js';
// later dynamic import queue

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!;

export async function listen(
  userId: string,
  channelId: string,
  guildId: string | undefined,
  invokerId: string,
  dmFlag?: boolean,
) {
  try {
    // 1. Fetch the user object to see if the target is a bot account
    const usrRes = await fetch(`https://discord.com/api/v10/users/${userId}`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` },
    });

    if (usrRes.ok) {
      const userJson = (await usrRes.json()) as { bot?: boolean; username: string };

      if (userJson.bot) {
        // ---- Music bot flow ----
        // TODO: Optionally implement music bot worker; for now return not supported
        return {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: '⚠️ Music listening feature is not yet supported.' },
        };
      }
    }
  } catch (err) {
    console.error('listen command: user lookup failed', err);
    // fall through to normal user flow
  }

  // ---- Spotify user flow ----
  let hookStatus: string | null = null;

  // Retrieve stored preference if flag not provided
  let effectiveDM = dmFlag;
  if (effectiveDM === undefined) {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('listen_dm')
        .eq('user_id', invokerId)
        .maybeSingle();
      effectiveDM = data?.listen_dm ?? false;
    } catch {/* ignore */}
  }

  // Persist preference if user explicitly provided the flag
  if (dmFlag !== undefined) {
    const { data: existing } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('user_id', invokerId)
      .maybeSingle();

    if (existing) {
      // Update only the preference column to avoid NOT-NULL violations
      await supabase
        .from('profiles')
        .update({ listen_dm: dmFlag, updated_at: new Date().toISOString() })
        .eq('user_id', invokerId)
        .throwOnError();
    } else {
      // Insert a fresh profile row with required fields
      const userRes = await fetch(`https://discord.com/api/v10/users/${invokerId}`, {
        headers: { Authorization: `Bot ${BOT_TOKEN}` },
      });
      const userObj = (await userRes.json()) as { username?: string; avatar?: string };

      await supabase
        .from('profiles')
        .insert({
          user_id: invokerId,
          username: userObj.username ?? 'Unknown',
          avatar_url: userObj.avatar
            ? `https://cdn.discordapp.com/avatars/${invokerId}/${userObj.avatar}.png`
            : null,
          listen_dm: dmFlag,
          updated_at: new Date().toISOString(),
        })
        .throwOnError();
    }
  }

  let destChannelId = channelId;

  if (effectiveDM) {
    // open DM with invoker
    try {
      const dmResp = await fetch('https://discord.com/api/v10/users/@me/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bot ${BOT_TOKEN}` },
        body: JSON.stringify({ recipient_id: invokerId }),
      });
      if (dmResp.ok) {
        const dmJson = (await dmResp.json()) as { id: string };
        destChannelId = dmJson.id;
      }
    } catch (err) {
      console.error('Failed to open DM channel', err);
    }
  }

  try {
    const { enqueueListenJob } = await import('../../src/workers/queue.js');
    enqueueListenJob({ user_id: userId, channel_id: destChannelId, guild_id: guildId! });
  } catch (err) {
    console.error('Failed to enqueue listen job', err);
  }

  // Analytics row (optional)
  await supabase.from('listen_triggers').insert({
    user_id: userId,
    channel_id: channelId,
    guild_id: guildId,
    created_at: new Date().toISOString(),
  });

  // Prepare human-friendly username (optional)
  let targetUsername: string | null = null;
  try {
    const userRes = await fetch(`https://discord.com/api/v10/users/${userId}`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` },
    });
    if (userRes.ok) {
      const uJson = (await userRes.json()) as { username?: string };
      targetUsername = uJson.username ?? null;
    }
  } catch {/* ignore */}

  const listeningToSelf = userId === invokerId;

  let reply: string;
  if (hookStatus === 'no-spotify') {
    if (listeningToSelf) {
      reply = '⚠️ You are not currently listening to Spotify **or** “Display current activity” is disabled. Please start a song and enable the setting, then try /listen again.';
    } else {
      reply = `⚠️ <@${userId}> is not currently listening to Spotify.`;
    }
  } else {
    if (listeningToSelf) {
      reply = `🎧 Listening session started! I'll send you some fun facts${effectiveDM ? ' in your DMs.' : '.'}`;
    } else {
      const namePart = targetUsername ? `${targetUsername}'s` : `<@${userId}>'s`;
      reply = `🎧 Listening to ${namePart} Spotify status! I'll send you some fun facts${effectiveDM ? ' in your DMs.' : '.'}`;
    }
  }

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: reply },
  };
} 