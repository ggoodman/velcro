import styled from '@emotion/styled/macro';
import { runtime, CanceledError } from '@velcro/bundler';
import * as Monaco from 'monaco-editor';
import React, { useEffect, useRef, useContext, useState } from 'react';
import { Delayer, Throttler, DisposableStore, CancellationTokenSource } from 'ts-primitives';
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
        const errorOverlayBundle = await editorManager.bundler.generateBundleCode([], {
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
          token,
        });

        const bundle = await editorManager.bundler.generateBundleCode([resolvedEntrypointHref], {
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
        });

        const errorWatcher = new File([`${errorOverlayBundle}\n(${createBundleRuntime.toString()})();`], 'watcher.js', {
          type: 'text/javascript',
        });
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
<script src="${URL.createObjectURL(errorWatcher)}"></script>
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
        if (!(err instanceof CanceledError) && (err && err.name !== 'CanceledError')) {
          setMessages(messages => [...messages, { lines: [{ isInternal: false, text: err.message }] }]);
        }
      } finally {
        if (tokenSource) {
          tokenSource.cancel();
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
          if (!e.data || typeof e.data.type !== 'string' || !e.data.payload) {
            return;
          }

          switch (e.data.type) {
            case 'error_open': {
              debugger;
              if (!editorManager.editor) {
                return;
              }

              editorManager.focusHref(e.data.payload.fileName, {
                lineNumber: e.data.payload.lineNumber ? e.data.payload.lineNumber - 1 : undefined,
              });
              break;
            }
          }

          // console.log('message event', e.data);
          // if (e.data && e.data.type === 'error' && e.data.payload) {
          //   const readCache = new Map<string, { code: string; sourceMap?: any }>();

          //   const read = async (href: string): Promise<string> => {
          //     let code: string;

          //     if (href.startsWith('blob:')) {
          //       code = await fetch(href).then(res => res.text());
          //     } else if (href.startsWith('data:')) {
          //       const match = href.match(/^data:[^;]+;(?:charset=([^;]+);)?(?:(base64),)?(.*)$/);

          //       if (!match) {
          //         throw new Error(`Unexpected data URI: '${href}'`);
          //       }

          //       code = match[3];

          //       if (match[2].toLowerCase() === 'base64') {
          //         code = base64.decode(code);
          //       }
          //     } else {
          //       const buf = await editorManager.bundler.resolver.host.readFileContent(
          //         editorManager.bundler.resolver,
          //         new URL(href)
          //       );
          //       code = editorManager.bundler.resolver.decoder.decode(buf);
          //     }

          //     return code;
          //   };

          //   const readSource = async (href: string): Promise<{ code: string; sourceMap?: MappedSourceMap }> => {
          //     if (readCache.has(href)) {
          //       return readCache.get(href) as { code: string; sourceMap?: MappedSourceMap };
          //     }

          //     const code = await read(href);
          //     const sourceMappingUrl = getSourceMappingUrl(code);
          //     let sourceMap: any = undefined;

          //     if (sourceMappingUrl) {
          //       const sourceMapText = await read(sourceMappingUrl);
          //       sourceMap = JSON.parse(sourceMapText);

          //       if (sourceMap.mappings) {
          //         sourceMap.mappings = decode(sourceMap.mappings);
          //       }
          //     }

          //     const result = { code, sourceMap };

          //     readCache.set(href, result);

          //     return result;
          //   };

          //   let frames = [] as CallSite[];

          //   if (Array.isArray(e.data.payload.frames)) {
          //     try {
          //       frames = await Promise.all(
          //         e.data.payload.frames.map(async (frameOptions: CallSiteOptions) => {
          //           let frame = new CallSite(frameOptions);
          //           const href = frame.getFileName();
          //           const line = frame.getLineNumber();
          //           const column = frame.getColumnNumber();

          //           if (href && line && Number.isInteger(line) && column && Number.isInteger(column)) {
          //             const result = await readSource(href);

          //             if (!result.sourceMap) {
          //               return frame.with({
          //                 isInternal: true,
          //               });
          //             }

          //             const mappings = result.sourceMap.mappings[line - 1];

          //             if (!mappings || !mappings.length) {
          //               return frame.with({
          //                 isInternal: true,
          //               });
          //             }

          //             let mapping = mappings[0];

          //             for (let i = 1; i < mappings.length; i++) {
          //               const sourceColumn = mappings[i][0];

          //               if (sourceColumn > column) {
          //                 break;
          //               }

          //               mapping = mappings[i];
          //             }

          //             // We should now have the 'right' mapping

          //             // [ generatedCodeColumn, sourceIndex, sourceCodeLine, sourceCodeColumn, nameIndex ]
          //             const sourceFileIndex = mapping[1];
          //             const sourceFile =
          //               sourceFileIndex !== undefined ? result.sourceMap.sources[sourceFileIndex] : undefined;
          //             const sourceLine = mapping[2];
          //             const sourceColumn = mapping[3];

          //             if (sourceLine === undefined || sourceFile === undefined) {
          //               return frame.with({
          //                 isInternal: true,
          //               });
          //             }

          //             return frame.with({
          //               isInternal: false,
          //               columnNumber: sourceColumn,
          //               lineNumber: sourceLine + 1, // the mappings are 0-indexed
          //               fileName: sourceFile.replace(/^file:\/\/\//, ''),
          //             });
          //           }

          //           return frame;
          //         })
          //       );
          //     } catch (err) {
          //       console.warn({ err, trace: e.data.payload.frames }, 'Error resolving source locations for stack trace');
          //     }

          //     console.log('frames', frames);
          //     console.log('stack', frames.map(frame => frame.toString()).join('\n'));
          //   }

          //   setMessages(messages => [...messages, { lines: CallSite.prepareStackTrace(e.data.payload, frames) }]);
          // }
        };

        window.addEventListener('message', onMessage);
        return {
          dispose() {
            window.removeEventListener('message', onMessage);
          },
        };
      })()
    );

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

declare var Velcro: { runtime: typeof runtime };

function createBundleRuntime(filename?: string) {
  const ReactErrorOverlay = Velcro.runtime.require('react-error-overlay') as typeof import('react-error-overlay');

  ReactErrorOverlay.setEditorHandler(err => {
    window.parent.postMessage({ type: 'error_open', payload: err }, '*');
  });
  ReactErrorOverlay.startReportingRuntimeErrors({
    onError: () => console.log('onError?'),
    filename,
  });
}
