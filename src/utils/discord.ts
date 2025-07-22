/**
 * Helper to POST follow-up message (PATCH original interaction) and log response.
 * Discord replies to an interaction are done through webhook tokens.
 */
export async function patchOriginal(appId: string, token: string, body: any, tag = 'follow') {
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