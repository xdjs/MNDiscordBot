declare module '@napi-rs/canvas' {
  // Using `any` to avoid detailed type surface – enough for compilation.
  export type Canvas = any;
  export function createCanvas(width: number, height: number): Canvas;
  export function loadImage(src: string): Promise<any>;
  export const GlobalFonts: any;
} 