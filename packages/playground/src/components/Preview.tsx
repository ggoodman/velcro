import styled from '@emotion/styled/macro';
import { CanceledError } from '@velcro/bundler';
import * as Monaco from 'monaco-editor';
import React, { useEffect, useRef, useContext, useState } from 'react';
import { Delayer, Throttler, DisposableStore, CancellationTokenSource, IDisposable, Emitter } from 'ts-primitives';
import { EditorManagerContext } from '../lib/EditorManager';

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

  useEffect(() => {
    const disposable = new DisposableStore();
    const delayer = new Delayer(500);
    const throttler = new Throttler();

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

    const refreshPreview = async (token: Monaco.CancellationToken) => {
      const toInvalidate = Array.from(invalidations.current);

      setMessages([]);

      invalidations.current.clear();

      setBuildProgress({ completed: 0, total: 0 });

      let building = true;

      try {
        await Promise.all(
          toInvalidate.map(spec => {
            return editorManager.bundler.invalidate(spec, { token });
          })
        );

        const unresolvedEntrypointHref = Monaco.Uri.file('/').toString(true);
        const resolvedEntrypoint = await editorManager.bundler.resolver.resolve(unresolvedEntrypointHref);

        if (!resolvedEntrypoint.resolvedUrl) {
          throw new Error(`Unable to determine the entrypoing to your code`);
        }

        const resolvedEntrypointHref = resolvedEntrypoint.resolvedUrl.href;

        const bundle = await editorManager.bundler.generateBundleCode(
          [
            {
              type: 'inline',
              code: `(${createBundleRuntime.toString().replace('velcroRequire', 'require')})();`,
              href: 'playground:///runtime.js',
            },
            {
              type: 'href',
              href: resolvedEntrypointHref,
            },
          ],
          {
            dependencies: {
              'react-error-overlay': '^6.0.3',
            },
            onCompleteAsset: () => {
              if (building) {
                setBuildProgress(buildProgress => {
                  return {
                    completed: buildProgress.completed + 1,
                    total: buildProgress.total,
                  };
                });
              }
            },
            onEnqueueAsset: () => {
              if (building) {
                setBuildProgress(buildProgress => {
                  return {
                    completed: buildProgress.completed,
                    total: buildProgress.total + 1,
                  };
                });
              }
            },
            sourceMap: true,
            requireEntrypoints: true,
            token,
          }
        );

        const bundleFile = new File([bundle], resolvedEntrypointHref, {
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
</head>
<body>
<div id="root"></div>
<script src="${URL.createObjectURL(bundleFile)}"></script>
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

          if (previewIframeRef.current) {
            previewIframeRef.current.remove();
          }

          iframe.style.display = '';

          previewIframeRef.current = iframe;
        } catch (err) {
          iframe.remove();

          throw err;
        }
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

    disposable.add(delayer);

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
          console.log('onMessage', e);
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
  }, [editorManager.bundler, editorManager, invalidations]);

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

declare var velcroRequire: NodeRequire;

function createBundleRuntime(filename?: string) {
  const ReactErrorOverlay = velcroRequire('react-error-overlay') as typeof import('react-error-overlay');
  const channel = new MessageChannel();

  ReactErrorOverlay.setEditorHandler(err => {
    window.parent.postMessage({ type: 'error_open', payload: err }, '*');
  });
  ReactErrorOverlay.startReportingRuntimeErrors({
    onError: () => undefined,
    filename,
  });

  window.parent.postMessage({ type: 'hmr_ready', payload: channel.port1 }, '*', [channel.port1]);
}

class HmrClient implements IDisposable {
  private readonly onRequestManifestEmitter = new Emitter();

  constructor(private readonly port: MessagePort) {}

  get onRequestManifest() {
    return this.onRequestManifestEmitter.event;
  }

  dispose() {
    this.port.close();
  }
}
