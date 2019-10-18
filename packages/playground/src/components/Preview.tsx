import styled from '@emotion/styled/macro';
import * as Monaco from 'monaco-editor';
import React, { useEffect, useRef, useContext, useState } from 'react';
import { Delayer, Throttler, DisposableStore, CancellationTokenSource } from 'ts-primitives';
import { EditorManagerContext } from '../lib/EditorManager';

interface Message {
  text: string;
}

const PreviewProgress = styled.div<{ completed: number; pending: number }>`
  z-index: 1;
  position: absolute;
  top: 0;
  width: ${props =>
    props.pending || props.completed
      ? `${Math.round((100 * props.completed) / (props.completed + props.pending))}%`
      : 0};
  left: 0;
  height: ${props => (props.pending || props.completed ? '2px' : '0')};
  background-color: #008cba;
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
const PreviewMessageError = styled.div`
  padding: 1em 2em;
  font-family: monospace;
  font-size: 16px;
  background-color: rgba(255, 0, 0, 0.5);
  backdrop-filter: brightness(50%);
  color: white;
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
const PreviewMessage: React.FC<{ message: Message }> = ({ message }) => {
  return <PreviewMessageError>{message.text}</PreviewMessageError>;
};

const Preview: React.FC<{ className?: string }> = props => {
  const invalidations = useRef(new Set<string>());
  const previewWrapRef = useRef<HTMLDivElement | null>(null);
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const editorManager = useContext(EditorManagerContext);
  const [messages, setMessages] = useState([] as Message[]);
  const [buildProgress, setBuildProgress] = useState({ pending: 0, completed: 0 });

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

        const bundle = await editorManager.bundler.generateBundleCode([resolvedEntrypointHref], {
          onCompleteAsset: () =>
            setBuildProgress(buildProgress => ({
              completed: buildProgress.completed + 1,
              pending: buildProgress.pending,
            })),
          onEnqueueAsset: () =>
            setBuildProgress(buildProgress => ({
              completed: buildProgress.completed,
              pending: buildProgress.pending + 1,
            })),
          sourceMap: true,
          requireEntrypoints: true,
          token,
        });

        const errorWatcher = new File(
          [
            `
window.onerror = function(msg, url, lineNo, columnNo, err) {
const payload = { url, lineNo, columnNo, name: err.name };
for (const key of Object.getOwnPropertyNames(err)) {
payload[key] = err[key];
}
window.parent.postMessage({ type: 'error', payload }, '*');
}
      `,
          ],
          'watcher.js',
          {
            type: 'text/javascript',
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
        setMessages(messages => [...messages, { text: err.message }]);
      } finally {
        setBuildProgress({ pending: 0, completed: 0 });
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
        const onMessage = (e: MessageEvent) => {
          if (e.data && e.data.type === 'error' && e.data.payload && e.data.payload.message) {
            setMessages(messages => [...messages, { text: e.data.payload.message }]);
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

    queueRefreshPreview([]);

    return () => disposable.dispose();
  }, [editorManager.bundler, invalidations]);

  return (
    <PreviewWrap className={props.className}>
      <PreviewProgress completed={buildProgress.completed} pending={buildProgress.pending}></PreviewProgress>
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
