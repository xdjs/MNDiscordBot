import { InteractionResponseType } from 'discord-interactions';
import { supabase } from '../lib/supabase.js';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!;

/**
 * Generates a profile card image and sends it as a follow-up message.
 * Returns a deferred response so the initial slash command is acknowledged within 3 seconds.
 */
export async function profile(interaction: any) {
  const { user } = interaction.member;
  const userId: string = user.id;
  const username: string = user.username;
  const avatarUrl = `https://cdn.discordapp.com/avatars/${userId}/${user.avatar}.png?size=256`;

  // Store / update cached fields in Supabase
  try {
    await supabase.from('profiles').upsert({
      user_id: userId,
      username,
      avatar_url: avatarUrl,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[profile] Supabase upsert error', err);
  }

  // ---------------- Canvas drawing ----------------
  const width = 550;
  const height = 160;
  const canvas = createCanvas(width, height);
  const ctx: any = canvas.getContext('2d');

  // Helper: rounded rectangle
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
  ctx.fillStyle = '#1e1e1e';
  roundRect(ctx, 0, 0, width, height, 18);

  // Avatar
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
  } catch (e) {
    console.error('[profile] Failed to draw avatar', e);
  }

  // Status dot (green)
  const dotRadius = 12;
  ctx.fillStyle = '#3ba55d';
  ctx.beginPath();
  ctx.arc(avatarX + avatarSize - dotRadius, avatarY + avatarSize - dotRadius, dotRadius, 0, Math.PI * 2);
  ctx.fill();

  // Username text
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 42px Sans';
  ctx.textBaseline = 'middle';
  ctx.fillText(username, avatarX + avatarSize + 30, height / 2);

  const buffer = await canvas.encode('png');

  // ------------- Send follow-up message -------------
  try {
    const form: any = new (globalThis as any).FormData();
    form.append(
      'payload_json',
      JSON.stringify({
        attachments: [{ id: 0, filename: 'profile.png' }],
      }),
    );
    // `files[0]` follows Discord convention for multi-file upload
    const blob: any = new (globalThis as any).Blob([buffer], { type: 'image/png' });
    form.append('files[0]', blob, 'profile.png');

    await fetch(
      `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}`,
      {
        method: 'POST',
        headers: { Authorization: `Bot ${BOT_TOKEN}` },
        body: form as any,
      },
    );
  } catch (err) {
    console.error('[profile] Failed to send follow-up', err);
  }

  // Immediate ACK so the command doesn’t time out
  return {
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
  };
} 