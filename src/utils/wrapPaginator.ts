// Utility for creating paginated wrap embeds + button rows (raw API shape, no discord.js builders needed)

const PER_PAGE = 5; // show 5 users per page
const COLOR = 0x2f3136;

interface EmbedPayload {
  embeds: any[];
  components?: any[];
}

interface UserRowMeta {
  user_id: string;
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
): EmbedPayload {
  const totalPages = Math.max(1, Math.ceil(lines.length / PER_PAGE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const sliceStart = safePage * PER_PAGE;
  const sliceEnd = sliceStart + PER_PAGE;
  const slice = lines.slice(sliceStart, sliceEnd);
  const userSlice = userRows.slice(0, PER_PAGE); // should already be <= PER_PAGE but guard

  const embed = {
    title,
    description: slice.join('\n') || '—',
    color: COLOR,
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

  // Numeric selection row (1-5)
  const numRow = {
    type: 1,
    components: Array.from({ length: PER_PAGE }).map((_, idx) => {
      const rowMeta = userSlice[idx];
      return {
        type: 2,
        style: 2,
        label: String(idx + 1),
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
