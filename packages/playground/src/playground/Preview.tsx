import styled from '@emotion/styled/macro';
import { InvariantViolation } from '@velcro/bundler';
import { CanceledError } from '@velcro/resolver';
import * as Monaco from 'monaco-editor';
import React, { useEffect, useRef, useContext, useState } from 'react';
import {
  Delayer,
  Throttler,
  DisposableStore,
  CancellationTokenSource,
  IDisposable,
  Emitter,
  Event,
  timeout,
  CancellationToken,
} from 'ts-primitives';

import { EditorManagerContext } from '../lib/EditorManager';
import { TimeoutError } from '../lib/error';
import { HmrBuildErrorRequest, HmrReloadRequest, HmrReloadResponse } from '../lib/previewRuntime';

export interface DeferredExecutionModuleRecord {
  code: string;
  dependencies: Record<string, string>;
}

export interface DeferredExecutionManifest {
  aliases: Record<string, string>;
  entrypoints: Record<string, string>;
  modules: Record<string, DeferredExecutionModuleRecord>;
}

interface MessageLine {
  isInternal: boolean;
  text: string;
}
interface Message {
  lines: MessageLine[];
}

const PreviewProgress = styled.div<{ completed: number; total: number }>`
  z-index: 1;
  position: absolute;
  top: 0;
  width: ${props => (props.total ? `${Math.round((100 * props.completed) / props.total)}%` : 0)};
  left: 0;
  height: ${props => (props.total ? '2px' : '0')};
  background-color: #008cba;
  transition: width 0.5s 0s cubic-bezier(0.455, 0.03, 0.515, 0.955);
`;
const PreviewIframeWrap = styled.div`
  position: relative;
  overflow: hidden;

  & > iframe {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    border: none;
    width: 100%;
    height: 100%;
  }
`;
const PreviewWrap = styled.div`
  position: relative;
  background: white;

  ${PreviewIframeWrap} {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
  }
`;
const PreviewMessageError = styled.ul`
  margin: 0;
  padding: 1em 2em;
  font-family: monospace;
  font-size: 16px;
  background-color: rgba(255, 0, 0, 0.5);
  backdrop-filter: brightness(50%);
  color: white;
  list-style: none;
`;
const PreviewMessageErrorText = styled.li<{ isInternal: boolean }>`
  white-space: pre-wrap;
  opacity: ${props => (props.isInternal ? 0.7 : 1.0)};
`;
const PreviewMessages = styled.div`
  z-index: 1;
  position: absolute;
  bottom: 0;
  right: 0;
  left: 0;
  display: flex;
  flex-direction: column-reverse;
`;
const PreviewMessageLine: React.FC<{ line: MessageLine }> = ({ line }) => {
  return <PreviewMessageErrorText isInternal={line.isInternal}>{line.text}</PreviewMessageErrorText>;
};
const PreviewMessage: React.FC<{ message: Message }> = ({ message }) => {
  return message.lines.length ? (
    <PreviewMessageError>
      {message.lines.map((line, i) => (
        <PreviewMessageLine key={i} line={line}></PreviewMessageLine>
      ))}
    </PreviewMessageError>
  ) : null;
};

const Preview: React.FC<{ className?: string }> = props => {
  const invalidations = useRef(new Set<string>());
  const previewWrapRef = useRef<HTMLDivElement | null>(null);
  const hmrClientRef = useRef<HmrClient | null>(null);
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const editorManager = useContext(EditorManagerContext);
  const [messages, setMessages] = useState([] as Message[]);
  const [buildProgress, setBuildProgress] = useState({ completed: 0, total: 0 });
  const runtimeBundleString = useRef('');

  useEffect(() => {
    const disposable = new DisposableStore();
    const delayer = new Delayer(500);
    const throttler = new Throttler();

    // const worker = new Worker('../lib/bundlerWorker', { type: 'module' });
    // const hostApi: import('../lib/bundlerWorker').HostApi = {
    //   async getCanonicalUrl(href) {
    //     const url = await editorManager.inflightCachingHost.getCanonicalUrl(editorManager.resolver, new URL(href));

    //     return url.href;
    //   },
    //   async getResolveRoot(href) {
    //     const url = await editorManager.inflightCachingHost.getResolveRoot(editorManager.resolver, new URL(href));

    //     return url.href;
    //   },
    //   async listEntries(href) {
    //     const entries = await editorManager.inflightCachingHost.listEntries(editorManager.resolver, new URL(href));

    //     return entries.map(entry => {
    //       return {
    //         type: entry.type,
    //         href: entry.url.href,
    //       };
    //     });
    //   },
    //   async readFileContent(href) {
    //     const content = await editorManager.inflightCachingHost.readFileContent(editorManager.resolver, new URL(href));

    //     return editorManager.resolver.decoder.decode(content);
    //   },
    //   async resolveBareModule(spec, pathname) {
    //     const url = await editorManager.resolveBareModule(spec, pathname);

    //     return url.href;
    //   },
    // };
    // const workerClient = expose(hostApi).connect<import('../lib/bundlerWorker').WorkerApi>(
    //   Transport.fromDomWorker(worker)
    // );

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let building = true;
    let tokenSource = new CancellationTokenSource();

    const queueRefreshPreview = (uris: string[]) => {
      tokenSource.cancel();
      tokenSource.dispose();

      tokenSource = new CancellationTokenSource();

      for (const uri of uris) {
        invalidations.current.add(uri);
      }

      delayer.trigger(() => throttler.queue(() => refreshPreview(tokenSource.token)));
    };

    const rerender = async (invalidate: string[], token: CancellationToken) => {
      let runtimeBundle = runtimeBundleString.current;

      try {
        if (!runtimeBundle) {
          const result = await editorManager.workerPeer.invoke(
            'generateBundle',
            [`memory:/preview/index.js`],
            onEnqueueAsset,
            onCompleteAsset,
            {
              executeEntrypoints: true,
              sourceMap: false,
            }
          );
          runtimeBundle = result.code;
          runtimeBundleString.current = runtimeBundle;
        }

        let codeBundle: string;

        try {
          const unresolvedEntrypointHref = Monaco.Uri.file('/').toString(true);
          const resolvedEntrypointHref = await editorManager.workerPeer.invoke('resolve', unresolvedEntrypointHref);

          if (!resolvedEntrypointHref) {
            throw new Error(`Unable to determine the entrypoing to your code`);
          }

          const result = await editorManager.workerPeer.invoke(
            'generateBundle',
            [resolvedEntrypointHref],
            onEnqueueAsset,
            onCompleteAsset,
            {
              executeEntrypoints: true,
              invalidations: invalidate,
              sourceMap: true,
            }
          );

          codeBundle = result.code;
        } catch (err) {
          if (err.name === 'CanceledError') {
            throw err;
          }

          codeBundle = `ReactErrorOverlay.reportBuildError(${JSON.stringify(err.message)});\n`;
        }

        const runtimeBundleFile = new File([runtimeBundle], 'playground:///runtime.js', {
          type: 'text/javascript',
        });
        const codeBundleFile = new File([`var __velcroRuntime = ${codeBundle};\n`], 'playground:///index.js', {
          type: 'text/javascript',
        });
        const markup = new File(
          [
            `
  <!DOCTYPE html>
  <html lang="en">
  <head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="ie=edge">
  <title>Document</title>
  <script src="${URL.createObjectURL(runtimeBundleFile)}"></script>
  </head>
  <body>
  <div id="root"></div>
  <script src="${URL.createObjectURL(codeBundleFile)}"></script>
  </body>
  </html>`,
          ],
          Monaco.Uri.file('/index.html').toString(true),
          {
            type: 'text/html',
          }
        );
        const htmlUrl = URL.createObjectURL(markup);
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = htmlUrl;

        if (previewWrapRef.current) {
          previewWrapRef.current.appendChild(iframe);
        }

        try {
          await new Promise((resolve, reject) => {
            iframe.onload = () => resolve();
            iframe.onerror = reject;
          });
        } catch (err) {
          iframe.remove();
          throw err;
        }

        if (previewIframeRef.current) {
          previewIframeRef.current.remove();
        }

        iframe.style.display = '';

        previewIframeRef.current = iframe;
      } catch (err) {
        tokenSource.cancel();

        if (!(err instanceof CanceledError) && (err && err.name !== 'CanceledError')) {
          setMessages(messages => [...messages, { lines: [{ isInternal: false, text: err.message }] }]);
        }
      } finally {
        if (tokenSource) {
          tokenSource.dispose();
        }

        building = false;

        setBuildProgress({ completed: 0, total: 0 });
      }
    };

    const hotReload = async (invalidate: string[], hmrClient: HmrClient, token: CancellationToken) => {
      try {
        const unresolvedEntrypointHref = Monaco.Uri.file('/').toString(true);
        const resolvedEntrypointHref = await editorManager.workerPeer.invoke('resolve', unresolvedEntrypointHref);

        if (!resolvedEntrypointHref) {
          throw new Error(`Unable to determine the entrypoing to your code`);
        }

        const result = await editorManager.workerPeer.invoke(
          'generateBundle',
          [resolvedEntrypointHref],
          onEnqueueAsset,
          onCompleteAsset,
          {
            executeEntrypoints: false,
            incremental: true,
            invalidations: invalidate,
            runtime: '__velcroRuntime',
            sourceMap: true,
          }
        );
        const updatedBundleFile = new File([result.code], 'playground:///runtime.js', {
          type: 'text/javascript',
        });
        const updatedBundleHref = URL.createObjectURL(updatedBundleFile);

        hmrClient.send({
          type: 'reload',
          invalidations: result.invalidations,
          href: updatedBundleHref,
        });

        await Promise.race([
          Event.toPromise(hmrClient.onReload),
          timeout(5000).then(() => {
            throw new TimeoutError(`HMR refresh timed out`);
          }),
        ]);
      } catch (err) {
        hmrClient.send({
          type: 'build_error',
          message: err.message,
          stack: err.stack,
        });
      }
    };

    const refreshPreview = async (token: CancellationToken) => {
      const refreshId = Date.now();
      console.time(`Refresh ${refreshId}`);
      const toInvalidate = Array.from(invalidations.current);

      setMessages([]);

      invalidations.current.clear();

      building = true;
      setBuildProgress({ completed: 0, total: 0 });

      try {
        if (!hmrClientRef.current) {
          return await rerender(toInvalidate, token);
        } else {
          return await hotReload(toInvalidate, hmrClientRef.current, token);
        }
      } catch (err) {
      } finally {
        console.timeEnd(`Refresh ${refreshId}`);
        building = false;
        setBuildProgress({ completed: 0, total: 0 });
      }
    };

    disposable.add(delayer);

    const onEnqueueAsset = () => {
      if (building) {
        setBuildProgress(buildProgress => {
          return {
            completed: buildProgress.completed,
            total: buildProgress.total + 1,
          };
        });
      }
    };
    const onCompleteAsset = () => {
      if (building) {
        setBuildProgress(buildProgress => {
          return {
            completed: buildProgress.completed + 1,
            total: buildProgress.total,
          };
        });
      }
    };

    for (const model of Monaco.editor.getModels()) {
      disposable.add(
        model.onDidChangeContent(() => {
          queueRefreshPreview([model.uri.toString(true)]);
        })
      );
    }

    disposable.add(
      Monaco.editor.onDidCreateModel(model => {
        queueRefreshPreview([model.uri.toString(true)]);

        disposable.add(
          model.onDidChangeContent(() => {
            queueRefreshPreview([model.uri.toString(true)]);
          })
        );
      })
    );

    disposable.add(
      Monaco.editor.onWillDisposeModel(model => {
        queueRefreshPreview([model.uri.toString(true)]);
      })
    );

    disposable.add(
      (() => {
        const onMessage = async (e: MessageEvent) => {
          if (
            (previewIframeRef.current && e.source !== previewIframeRef.current.contentWindow) ||
            !e.data ||
            typeof e.data.type !== 'string' ||
            !e.data.payload
          ) {
            return;
          }

          switch (e.data.type) {
            case 'error_open': {
              if (!editorManager.editor) {
                return;
              }

              const model = editorManager.getModelByHref(e.data.payload.fileName);

              if (model) {
                let lineNumber: number | undefined = e.data.payload.lineNumber;
                let columnNumber: number | undefined = undefined;

                if (lineNumber !== undefined) {
                  const row = model.getLineContent(lineNumber);
                  const matches = row.match(/^(\s*)/);

                  columnNumber = matches ? matches[1].length + 1 : undefined;
                }

                editorManager.focusModel(model, {
                  lineNumber,
                  columnNumber,
                });
              }

              break;
            }
            case 'hmr_ready': {
              if (!(e.data.payload instanceof MessagePort)) {
                console.warn(
                  'Received "hmr_ready" message from preview but did not receive the expected MessagePort payload',
                  e.data
                );
                return;
              }

              hmrClientRef.current = new HmrClient(e.data.payload);
              break;
            }
            default: {
              console.debug({ message: e.data }, 'Unknown message received from preview iframe');
            }
          }
        };

        window.addEventListener('message', onMessage);
        return {
          dispose() {
            window.removeEventListener('message', onMessage);
          },
        };
      })()
    );

    disposable.add({
      dispose() {
        if (hmrClientRef.current) {
          hmrClientRef.current.dispose();
        }
      },
    });

    queueRefreshPreview([]);

    return () => disposable.dispose();
  }, [editorManager.workerPeer, editorManager, invalidations]);

  return (
    <PreviewWrap className={props.className}>
      <PreviewProgress completed={buildProgress.completed} total={buildProgress.total}></PreviewProgress>
      {previewIframeRef.current ? null : 'Building the preview...'}
      <PreviewIframeWrap ref={previewWrapRef}></PreviewIframeWrap>
      <PreviewMessages>
        {messages.map((message, idx) => (
          <PreviewMessage key={idx} message={message}></PreviewMessage>
        ))}
      </PreviewMessages>
    </PreviewWrap>
  );
};

export default styled(Preview)``;

class HmrClient implements IDisposable {
  private readonly onReloadEmitter = new Emitter<HmrReloadResponse>();

  constructor(private readonly port: MessagePort) {
    port.onmessage = e => {
      if (!e.data || typeof e.data !== 'object') {
        throw new InvariantViolation('Unexpected message received from HMR client');
      }

      switch (e.data.type) {
        case 'reload': {
          this.onReloadEmitter.fire(e.data);
          break;
        }
        default: {
          throw new InvariantViolation(`Unexpected message with type '${e.data.type}' received from HMR client`);
        }
      }
    };
  }

  get onReload() {
    return this.onReloadEmitter.event;
  }

  dispose() {
    this.port.close();
  }

  send(message: HmrBuildErrorRequest | HmrReloadRequest) {
    this.port.postMessage(message);
  }
}
