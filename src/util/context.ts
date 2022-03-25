import type { Context } from '@ggoodman/context';

export function signalForContext(ctx: Context): AbortSignal {
  const ac = new AbortController();

  ctx.onDidCancel(() => {
    ac.abort();
  });

  if (ctx.error()) {
    ac.abort();
  }

  return ac.signal;
}
