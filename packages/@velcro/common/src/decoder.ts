export class Decoder {
  private readonly decoder: TextDecoder | undefined;

  constructor() {
    if (typeof TextDecoder !== 'undefined') {
      this.decoder = new TextDecoder();
    } else if (typeof Buffer !== 'function' || typeof Buffer['from'] !== 'function') {
      throw new Error(
        'The environment supports neither the TextDecoder nor Buffer API. Please consider polyfilling one of these.'
      );
    }
  }

  decode(buf: BufferSource): string {
    const str = this.decoder
      ? this.decoder.decode(buf)
      : (Buffer as any).from(buf).toString('utf-8');

    return str.charCodeAt(0) === 0xfeff ? str.slice(1) : str;
  }
}
