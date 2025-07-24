import { parentPort, workerData } from 'node:worker_threads';
import { Canvas, loadImage } from 'skia-canvas';

interface WorkerInput {
  username: string;
  avatarUrl: string;
  bgUrl: string | null;
}

(async () => {
  const { username, avatarUrl, bgUrl } = workerData as WorkerInput;

  const width = 550;
  const height = 160;
  const canvas = new Canvas(width, height);
  const ctx: any = canvas.getContext('2d');

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
  if (typeof bgUrl === 'string' && bgUrl) {
    try {
      const bgImg = await loadImage(bgUrl);
      ctx.save();
      ctx.beginPath();
      roundRect(ctx, 0, 0, width, height, 18);
      ctx.clip();
      ctx.drawImage(bgImg, 0, 0, width, height);
      ctx.restore();
    } catch {}
  } else {
    ctx.fillStyle = '#1e1e1e';
    roundRect(ctx, 0, 0, width, height, 18);
  }

  // Avatar
  const avatarSize = 60;
  const avatarX = 22;
  const avatarY = height - avatarSize - 22;
  try {
    const img = await loadImage(avatarUrl);
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, avatarX, avatarY, avatarSize, avatarSize);
    ctx.restore();
  } catch {}

  // Status dot
  ctx.fillStyle = '#3ba55d';
  const dotR = 6;
  ctx.beginPath();
  ctx.arc(avatarX + avatarSize - dotR, avatarY + avatarSize - dotR, dotR, 0, Math.PI * 2);
  ctx.fill();

  // Username text
  ctx.font = 'bold 42px Sans';
  ctx.textBaseline = 'bottom';
  const textY = height - 22;
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#000000';
  ctx.strokeText(username || 'Unknown', avatarX + avatarSize + 30, textY);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(username || 'Unknown', avatarX + avatarSize + 30, textY);

  const buffer: Buffer = await (canvas as any).png;
  parentPort!.postMessage(buffer);
})(); 