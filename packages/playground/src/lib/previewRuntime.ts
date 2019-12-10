export interface HmrBuildErrorRequest {
  type: 'build_error';
  message?: string;
  stack?: string;
}
export interface HmrReloadRequest {
  type: 'reload';
  href: string;
  invalidations: string[];
}

export interface HmrReloadResponse {}

declare var velcroRequire: NodeRequire;
declare var __velcroRuntime: import('@velcro/bundler').Runtime;

/**
 * Important: This function needs to be fully self-contained because it will be stringified.
 * @param filename
 */
export function createBundleRuntime() {
  const ReactErrorOverlay = velcroRequire('react-error-overlay') as typeof import('react-error-overlay');
  const channel = new MessageChannel();

  //@ts-ignore
  window.ReactErrorOverlay = ReactErrorOverlay;

  ReactErrorOverlay.setEditorHandler(err => {
    window.parent.postMessage({ type: 'error_open', payload: err }, '*');
  });
  ReactErrorOverlay.startReportingRuntimeErrors({
    onError: () => undefined,
  });

  channel.port2.onmessage = function(e) {
    if (!e.data || typeof e.data !== 'object') {
      throw new Error(`Unexpected message received by HMR server`);
    }
    const runtime = __velcroRuntime;

    switch (e.data.type) {
      case 'build_error': {
        ReactErrorOverlay.dismissRuntimeErrors();
        ReactErrorOverlay.reportBuildError(e.data.message || e.data);

        channel.port2.postMessage({
          type: 'reload',
        });
        break;
      }
      case 'reload': {
        if (isValidReload(e.data)) {
          ReactErrorOverlay.dismissBuildError();
          ReactErrorOverlay.dismissRuntimeErrors();
          const reload = e.data;
          const queue = reload.invalidations.slice();
          const seen = new Set<string>([runtime.root.id]);
          const potentialOrphans = new Set<string>();
          const requireReload = new Set<string>();
          const acceptCallbackQueue = [] as ({ module: typeof runtime.root; cb: () => void })[];
          const disposeCallbackQueue = [] as ({ module: typeof runtime.root; cb: () => void })[];

          while (queue.length) {
            const href = queue.shift()!;

            if (seen.has(href)) continue;
            seen.add(href);

            const module = runtime.get(href);

            if (!module) {
              continue;
            }

            requireReload.add(module.id);

            module.dependencies.forEach(dependency => {
              potentialOrphans.add(dependency.id);
            });

            potentialOrphans.delete(module.id);

            for (const disposeCallback of module.disposeCallbacks) {
              disposeCallbackQueue.push({ module, cb: disposeCallback.cb });
            }

            if (module.acceptCallbacks.length) {
              for (const acceptCallback of module.acceptCallbacks) {
                acceptCallbackQueue.push({ module, cb: acceptCallback.cb });
              }

              requireReload.delete(module.id);
            } else {
              let shouldReload = true;

              module.dependents.forEach(dependent => {
                if (dependent.id !== runtime.root.id) {
                  queue.push(dependent.id);
                  shouldReload = false;
                }
              });

              if (!shouldReload) {
                requireReload.delete(module.id);
              }
            }
          }

          seen.forEach(href => {
            // Only remove modules that were explicitly invalidated
            if (reload.invalidations.indexOf(href) >= 0) {
              runtime.unregister(href);
            }

            if (href !== runtime.root.id) {
              runtime.remove(href);
            }
          });

          const script = document.createElement('script');
          script.src = reload.href;
          script.onerror = function(err) {
            channel.port2.postMessage({
              type: 'reload',
              err,
            });
          };
          script.onload = function() {
            try {
              // Find any module that will become orphaned by this change and
              // dispose it
              potentialOrphans.forEach(potentialOrphan => {
                const potentialOrphanModule = runtime.get(potentialOrphan);

                if (potentialOrphanModule && potentialOrphanModule.dependents.size === 0) {
                  for (const disposeCallback of potentialOrphanModule.disposeCallbacks) {
                    disposeCallbackQueue.push({
                      module: potentialOrphanModule,
                      cb: disposeCallback.cb,
                    });
                  }

                  if (potentialOrphan !== runtime.root.id) {
                    runtime.remove(potentialOrphan);
                  }
                }
              });

              disposeCallbackQueue.forEach(({ cb }) => {
                cb();
              });
              acceptCallbackQueue.forEach(({ cb }) => {
                cb();
              });

              for (const toReload of requireReload) {
                runtime.root.require(toReload);
              }

              channel.port2.postMessage({
                type: 'reload',
              });
            } catch (err) {
              channel.port2.postMessage({
                type: 'reload',
                err,
              });

              throw err;
            }
          };

          document.head.appendChild(script);
        }
      }
    }
  };

  window.parent.postMessage({ type: 'hmr_ready', payload: channel.port1 }, '*', [channel.port1]);

  //#region Type Guards

  function isObject(val: unknown): val is Record<string | number, unknown> {
    return val && typeof val === 'object';
  }

  function isString(val: unknown): val is string {
    return typeof val === 'string';
  }

  function isValidReload(message: unknown): message is HmrReloadRequest {
    if (!isObject(message)) return false;

    if (message.type !== 'reload') return false;

    if (!Array.isArray(message.invalidations) || message.invalidations.find(entry => typeof entry !== 'string')) {
      return false;
    }

    return isString(message.href);
  }
  //#endregion
}
