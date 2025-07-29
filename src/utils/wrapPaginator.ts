// Utility for creating paginated wrap embeds + button rows (raw API shape, no discord.js builders needed)

const PER_PAGE = 15;
const COLOR = 0x2f3136;

interface EmbedPayload {
  embeds: any[];
  components?: any[];
}

export function buildWrapPayload(lines: string[], page: number, title: string): EmbedPayload {
  const totalPages = Math.max(1, Math.ceil(lines.length / PER_PAGE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const slice = lines.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE);

  const embed = {
    title,
    description: slice.join('\n') || '—',
    color: COLOR,
    footer: { text: `Page ${safePage + 1} / ${totalPages}` },
  };

  if (totalPages === 1) return { embeds: [embed] };

  const row = {
    type: 1, // action row
    components: [
      {
        type: 2,
        style: 2, // Secondary
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

  return { embeds: [embed], components: [row] };
}