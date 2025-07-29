import { Client, ActivityType, REST, Routes } from 'discord.js';
import { sessions, scheduleListenTimeout } from '../sessions/listen.js';
import { getFunFact } from '../utils/openai.js';
import { isWrapped } from '../sessions/wrap.js';
import { supabase } from '../../api/lib/supabase.js';

export function registerPresenceListener(client: Client, rest: REST) {
  client.on('presenceUpdate', async (_oldPresence, newPresence) => {
    console.log('[presence] event received for user', newPresence.userId, 'guild', newPresence.guild?.id);
    const userId = newPresence.userId;
    const guildId = newPresence.guild?.id;

    // ---- Spotify Wrap tracking (runs for every presence) ----
    if (guildId && isWrapped(guildId)) {
      const spot = newPresence.activities.find(
        (a) => a.type === ActivityType.Listening && a.name === 'Spotify',
      );
      if (spot) {
        console.log(`[presence-wrap] Guild ${guildId} | User ${userId} | New presence update detected`);
        const trackId: string | undefined = (spot as any).syncId ?? spot.details ?? undefined;
        console.log('[presence-wrap] extracted trackId:', trackId, 'details', spot.details);
        const raw = spot.state || spot.assets?.largeText?.split(' – ')[0] || '';
        const artist = raw
          .split(/[;,]/)
          .map((s) => s.trim())
          .filter(Boolean)
          .join(', ') || 'Unknown artist';
        console.log('[presence-wrap] artist:', artist);

        if (trackId) {
          try {
            const { data: existing } = await supabase
              .from('user_tracks')
              .select('tracks, artists, last_updated')
              .eq('guild_id', guildId)
              .eq('user_id', userId)
              .maybeSingle();

            const now = new Date();
            const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

            let tracksArr: any[] = [];
            let artistsArr: string[] = [];

            if (existing) {
              const isNewDay = existing.last_updated && new Date(existing.last_updated) < startOfDay;
              if (!isNewDay) {
                if (Array.isArray(existing.tracks)) tracksArr = existing.tracks;
                if (Array.isArray(existing.artists)) artistsArr = existing.artists;
              }
            }

            tracksArr.push({ id: trackId, ts: now.toISOString() });
            artistsArr.push(artist);

            // Calculate top values
            const trackCount: Record<string, number> = {};
            for (const t of tracksArr) {
              if (t.id) trackCount[t.id] = (trackCount[t.id] ?? 0) + 1;
            }
            const artistCount: Record<string, number> = {};
            for (const a of artistsArr) {
              artistCount[a] = (artistCount[a] ?? 0) + 1;
            }
            const topTrack = Object.entries(trackCount).sort((a,b)=>b[1]-a[1])[0]?.[0] ?? null;
            const topArtist = Object.entries(artistCount).sort((a,b)=>b[1]-a[1])[0]?.[0] ?? null;

            await supabase.from('user_tracks').upsert({
              guild_id: guildId,
              user_id: userId,
              username: newPresence.user?.username ?? null,
              tracks: tracksArr,
              artists: artistsArr,
              top_track: topTrack,
              top_artist: topArtist,
              last_updated: now.toISOString(),
              local_time: now.toISOString(),
            });
          } catch (err) {
            console.error('[wrap] failed to update user_tracks', err);
          }
        }
      }
    }

    // ---- Fun-fact listening session logic (only if a session exists) ----
    const session = sessions.get(userId);
    if (!session) return;

    const spotifyAct = newPresence.activities.find(
      (a) => a.type === ActivityType.Listening && a.name === 'Spotify',
    );

    // Reset inactivity timer if still listening
    if (spotifyAct) scheduleListenTimeout(userId, rest);

    if (!spotifyAct) return;

    const trackIdentifier = (spotifyAct as any).syncId ?? spotifyAct.details ?? '';
    if (!trackIdentifier || trackIdentifier === session.lastTrackId) return;

    // New song
    const artistRaw = spotifyAct.state || spotifyAct.assets?.largeText?.split(' – ')[0] || '';
    console.log('[presence] raw artist extracted:', artistRaw, 'user', userId);
    const artistText =
      artistRaw
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .join(', ') || 'Unknown artist';
    console.log('[presence] artistText normalized:', artistText, 'user', userId);

    session.lastTrackId = trackIdentifier;
    session.factCount += 1;

    const trackTitle = spotifyAct.details || undefined;
    const fact = await getFunFact(artistText, trackTitle);

    try {
      await rest.post(Routes.channelMessages(session.channelId), { body: { content: `🎶 ${fact}` } });

      // Reset inactivity timer **after** successfully sending a fun fact as well.
      // This provides an extra safety net in case presenceUpdate frequency is sparse
      // (e.g. very long tracks or rare presence refreshes).
      scheduleListenTimeout(userId, rest);
    } catch (err) {
      console.error('Failed to post fun fact', err);
    }

    if (session.factCount >= 10) {
      if (session.timeout) clearTimeout(session.timeout);
      sessions.delete(userId);
    }
  });
} 