import { atob, btoa } from 'b2a';

declare const Buffer: {
  from(
    buf: BufferSource | string,
    encoding?: 'base64'
  ): {
    toString(encoding: 'base64' | 'utf-8'): string;
  };
};

export namespace Base64 {
  export const decode =
    typeof Buffer !== 'undefined'
      ? (data: string) => Buffer.from(data, 'base64').toString('utf-8')
      : atob;

  export const encode =
    typeof Buffer !== 'undefined' ? (data: string) => Buffer.from(data).toString('base64') : btoa;
}
