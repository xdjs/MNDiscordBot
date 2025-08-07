import { Client, ActivityType, REST, Routes } from 'discord.js';
import { isWrapped } from '../sessions/wrap.js';
import { supabase } from '../../api/lib/supabase.js';

//logs the presence update event of users in the guild
export function registerPresenceListener(client: Client, rest: REST) {
  client.on('presenceUpdate', async (_oldPresence, newPresence) => {
    console.log('[presence] event received for user', newPresence.userId, 'guild', newPresence.guild?.id);
    const userId = newPresence.userId;
    const guildId = newPresence.guild?.id;

    // ---- Spotify Wrap tracking (runs for every presence) and apple music ----
    if (guildId && isWrapped(guildId)) {
      const spot = newPresence.activities.find(
        (a) => a.type === ActivityType.Listening && (a.name === 'Spotify' || /apple music|itunes/i.test(a.name)),
      );
      if (spot) {
        console.log(`[presence-wrap] Guild ${guildId} | User ${userId} | New presence update detected`);
        const trackId: string | undefined = (spot as any).syncId ?? undefined;
        const trackTitle: string = spot.details || 'Unknown title';
        console.log('[presence-wrap] extracted trackId:', trackId, 'details', spot.details);
        // Skip Spotify updates that lack a trackId (likely podcasts). However, allow Apple Music items which don't expose IDs.
        const isAppleMusic = /apple music|itunes/i.test(spot.name);
        if (!trackId && !isAppleMusic) {
          console.log('[presence-wrap] No trackId found for Spotify activity – skipping to avoid logging podcasts');
          return;
        }
        const raw = spot.state || spot.assets?.largeText?.split(' – ')[0] || '';
        const artistNames: string[] = raw   //artist names are split by commas, semicolons, ampersands, and spaces
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

            let tracksArr: any[] = [];
            let artistsArr: string[] = [];

            if (existing) {
              if (Array.isArray(existing.tracks)) tracksArr = existing.tracks;
              if (Array.isArray(existing.artists)) artistsArr = existing.artists;
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
              tracksArr.push({ id: trackId ?? null, title: trackTitle, artist: artistDisplay, ts: now.toISOString() });
              artistsArr.push(...artistNames);
            }

            // Calculate top values
            const trackStats: Record<string, { count: number; artist: string }> = {};
            for (const t of tracksArr) {
              const key = t.title ?? t.id ?? 'unknown';
              if (!trackStats[key]) trackStats[key] = { count: 0, artist: t.artist ?? 'Unknown' };
              trackStats[key].count += 1;
            }
            const artistCount: Record<string, number> = {};
            for (const a of artistsArr) {
              artistCount[a] = (artistCount[a] ?? 0) + 1;
            }
            const topTrackEntry = Object.entries(trackStats).sort((a,b)=>b[1].count - a[1].count)[0];
            const topTrack = topTrackEntry ? `${topTrackEntry[0]} — ${topTrackEntry[1].artist}` : null;
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
              // Data now resets only when the wrap post is made, not at UTC midnight
            });
          } catch (err) {
            console.error('[wrap] failed to update user_tracks', err);
          }
        }
      }
    }
  });
} 