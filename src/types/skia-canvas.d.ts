declare module 'skia-canvas' {
  export class Canvas {
    constructor(width: number, height: number);
    getContext(contextId: '2d'): any;
    renderToBuffer(type?: 'png' | 'jpeg' | 'webp'): Promise<Buffer>;
    readonly png: Promise<Buffer>;
  }
  export function loadImage(src: string): Promise<any>;
} 