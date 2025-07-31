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
 * Build a wrap embed payload with arrow navigation (◀ ▶) and numeric pick buttons (1-5).
 * The numeric buttons use custom_id = `wrap_pick_<userId>` so the interaction handler
 * can look up the artist info for that user in the DB.
 */
export function buildWrapPayload(
    lines: string[],
    page: number,
    title: string,
    userRows: UserRowMeta[], // rows corresponding to the *current page*
    accentColor?: number,
  ): EmbedPayload {
  const totalPages = Math.max(1, Math.ceil(lines.length / PER_PAGE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const sliceStart = safePage * PER_PAGE;
  const sliceEnd = sliceStart + PER_PAGE;
  const slice = lines.slice(sliceStart, sliceEnd);
  const userSlice = userRows.slice(0, PER_PAGE); // should already be <= PER_PAGE but guard

  // Build description with an extra blank line between each user entry
  const descLines: string[] = [];
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
  const navRow = {
    type: 1,
    components: [
      {
        type: 2,
        style: 2,
        label: '◀',
        custom_id: `wrap_prev_${safePage}`,
        disabled: safePage === 0,
      },
      {
        type: 2,
        style: 2,
        label: '▶',
        custom_id: `wrap_next_${safePage}`,
        disabled: safePage >= totalPages - 1,
      },
    ],
  };

  // Selection row – label is artist name (or number fallback)
  const numRow = {
    type: 1,
    components: Array.from({ length: PER_PAGE }).map((_, idx) => {
      const rowMeta = userSlice[idx];
      const artistLabel = rowMeta?.top_artist?.trim();
      const baseLabel = artistLabel && artistLabel.length
        ? artistLabel.slice(0, 25) // Discord button label max 80; keep shorter for aesthetics
        : String(idx + 1);
      return {
        type: 2,
        style: 2,
        label: baseLabel,
        custom_id: rowMeta ? `wrap_pick_${rowMeta.user_id}` : `wrap_pick_disabled_${idx}`,
        disabled: !rowMeta, // disable if no user in that slot
      };
    }),
  };

  if (totalPages === 1) {
    return { embeds: [embed], components: [navRow, numRow] };
  }

  return { embeds: [embed], components: [navRow, numRow] };
}
