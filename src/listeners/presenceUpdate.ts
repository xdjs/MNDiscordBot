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
        (a) => a.type === ActivityType.Listening && (a.name === 'Spotify' || /apple music|itunes/i.test(a.name)),
      );
      if (spot) {
        console.log(`[presence-wrap] Guild ${guildId} | User ${userId} | New presence update detected`);
        const trackId: string | undefined = (spot as any).syncId ?? undefined;
        const trackTitle: string = spot.details || 'Unknown title';
        console.log('[presence-wrap] extracted trackId:', trackId, 'details', spot.details);
        const raw = spot.state || spot.assets?.largeText?.split(' – ')[0] || '';
        const artistNames: string[] = raw
          .split(/[,;&]|\s+&\s+/)
          .map((s) => s.trim())
          .filter(Boolean);

        const artistDisplay = artistNames.join(', ') || 'Unknown artist';
        console.log('[presence-wrap] artists parsed:', artistDisplay);

        {
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

            // Avoid double-counting the same track when the user pauses and resumes.
            const lastEntry = tracksArr[tracksArr.length - 1];
            const isDuplicate =
              lastEntry &&
              (
                (trackId && lastEntry.id === trackId) ||
                (!trackId && lastEntry.title?.toLowerCase() === trackTitle.toLowerCase())
              ) &&
              // within 10 minutes window (safety)
              new Date(lastEntry.ts).getTime() > now.getTime() - 10 * 60 * 1000;

            if (!isDuplicate) {
              tracksArr.push({ id: trackId ?? null, title: trackTitle, ts: now.toISOString() });
              artistsArr.push(...artistNames);
            }

            // Calculate top values
            const trackCount: Record<string, number> = {};
            for (const t of tracksArr) {
              const key = t.title ?? t.id ?? 'unknown';
              trackCount[key] = (trackCount[key] ?? 0) + 1;
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
              // local_time column intentionally left untouched here; it's configured via /settime command
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
      (a) => a.type === ActivityType.Listening && (a.name === 'Spotify' || /apple music|itunes/i.test(a.name)),
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


  });
} 