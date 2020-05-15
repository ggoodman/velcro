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
    typeof atob === 'function'
      ? atob
      : typeof Buffer !== 'undefined'
      ? (data: string) => Buffer.from(data, 'base64').toString('utf-8')
      : () => {
          throw new Error(
            `The environment provides neither the atob function nor the Buffer API. Please consider polyfilling one of these.`
          );
        };

  export const encode =
    typeof btoa === 'function'
      ? btoa
      : typeof Buffer !== 'undefined'
      ? (data: string) => Buffer.from(data).toString('base64')
      : () => {
          throw new Error(
            `The environment provides neither the btoa function nor the Buffer API. Please consider polyfilling one of these.`
          );
        };
}
