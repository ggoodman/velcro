declare const Buffer: {
  from(
    buf: BufferSource | string
  ): {
    toString(encoding: 'base64'): string;
  };
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
