declare const Buffer: {
  from(
    buf: BufferSource
  ): {
    toString(encoding: 'utf-8'): string;
  };
};

export class Decoder {
  private readonly decoder: TextDecoder | undefined;

  constructor() {
    if (typeof TextDecoder !== 'undefined') {
      this.decoder = new TextDecoder();
    }
  }

  decode(buf: BufferSource): string {
    const str = this.decoder ? this.decoder.decode(buf) : Buffer.from(buf).toString('utf-8');

    return str.charCodeAt(0) === 0xfeff ? str.slice(1) : str;
  }
}
