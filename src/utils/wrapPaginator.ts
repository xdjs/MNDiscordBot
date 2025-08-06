// Utility for creating paginated wrap embeds + button rows (raw API shape, no discord.js builders needed)

const PER_PAGE = 5; // show 5 users per page
const COLOR = 0x2f3136;

interface EmbedPayload {
  embeds: any[];
  components?: any[];
}

interface UserRowMeta {
  user_id: string;
  top_artist?: string | null;
}

/**
 * Build a wrap embed payload with arrow navigation (◀ ▶) and artist pick buttons.
 * The artist buttons use custom_id = `wrap_pick_<userId>` so the interaction handler
 * can look up the artist info for that user in the DB.
 */
export function buildWrapPayload(
    lines: string[],
    page: number,
    title: string,
    userRows: UserRowMeta[], // rows corresponding to the *current page*
    accentColor?: number,
    embedType?: 'artist' | 'track' | 'legacy',
    wrapDate?: string, // YYYY-MM-DD for arrow IDs
  ): EmbedPayload {
  // First two lines are summary prompt and a blank line; keep them on every page
  const headerLines = lines.slice(0, 2);
  const listLines = lines.slice(2);

  // Calculate total pages based only on the list portion (exclude header lines)
  const totalPages = Math.max(1, Math.ceil(listLines.length / PER_PAGE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);

  const sliceStart = safePage * PER_PAGE;
  const sliceEnd = sliceStart + PER_PAGE;
  const slice = listLines.slice(sliceStart, sliceEnd);
  const userSlice = userRows.slice(0, PER_PAGE); // already sliced by caller

  // Build description with an extra blank line between each user entry
  const descLines: string[] = [];
  // Prepend header first
  descLines.push(...headerLines);

  slice.forEach((line, idx) => {
    descLines.push(line);
    // Insert blank line between user rows (which start after index 1)
    if (idx >= 2 && idx < slice.length - 1) {
      descLines.push('');
    }
  });

  const embed = {
    title,
    description: descLines.join('\n') || '—',
    color: accentColor ?? COLOR,
    footer: { text: `Page ${safePage + 1} / ${totalPages}` },
  };

  // Navigation (arrow) row
  const dateFragment = wrapDate ? `${wrapDate}_` : '';
  const navRow = {
    type: 1,
    components: [
      {
        type: 2,
        style: 2,
        label: '◀',
        custom_id: `wrap_prev_${dateFragment}${safePage}`,
        disabled: safePage === 0,
      },
      {
        type: 2,
        style: 2,
        label: '▶',
        custom_id: `wrap_next_${dateFragment}${safePage}`,
        disabled: safePage >= totalPages - 1,
      },
    ],
  };

  // Selection row – label and custom_id based on embed type
  const numRow = {
    type: 1,
    components: userSlice.map((rowMeta, idx) => {
      let baseLabel: string;
      let customId: string;
      
      if (embedType === 'track') {
        // For track embeds, use track name
        const trackLabel = (rowMeta as any)?.top_track?.trim();
        baseLabel = trackLabel && trackLabel.length
          ? trackLabel.slice(0, 25)
          : String(idx + 1);
        customId = trackLabel && trackLabel.length
          ? `wrap_track_${trackLabel.slice(0, 80)}`
          : `wrap_pick_${rowMeta.user_id}`;
      } else if (embedType === 'artist') {
        // For artist embeds, use artist name
        const artistLabel = rowMeta?.top_artist?.trim();
        baseLabel = artistLabel && artistLabel.length
          ? artistLabel.slice(0, 25)
          : String(idx + 1);
        customId = artistLabel && artistLabel.length
          ? `wrap_artist_${artistLabel.slice(0, 80)}`
          : `wrap_pick_${rowMeta.user_id}`;
      } else {
        // Legacy format - use artist name but old custom_id
        const artistLabel = rowMeta?.top_artist?.trim();
        baseLabel = artistLabel && artistLabel.length
          ? artistLabel.slice(0, 25)
          : String(idx + 1);
        customId = `wrap_pick_${rowMeta.user_id}`;
      }
      
      return {
        type: 2,
        style: 2,
        label: baseLabel,
        custom_id: customId,
      };
    }),
  };

  if (totalPages === 1) {
    // Single page – no navigation arrows needed
    return { embeds: [embed], components: [numRow] };
  }

  // Multiple pages – include arrow navigation row
  return { embeds: [embed], components: [navRow, numRow] };
}
