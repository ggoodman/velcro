type Buffer = {
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
      : typeof atob === 'function'
      ? (data: string) => decodeURIComponent(escape(atob(data)))
      : (_data: string) => {
          throw new Error(
            'The environment has neither the Buffer nor btoa functions. Please consider polyfilling one of these apis.'
          );
        };

  export const encode =
    typeof (globalThis as any)['Buffer'] !== 'undefined'
      ? (data: string) => ((globalThis as any)['Buffer'] as Buffer).from(data).toString('base64')
      : typeof btoa === 'function'
      ? (data: string) => btoa(unescape(encodeURIComponent(data)))
      : (_data: string) => {
          throw new Error(
            'The environment has neither the Buffer nor btoa functions. Please consider polyfilling one of these apis.'
          );
        };
}
