import styled from '@emotion/styled/macro';
import { Uri } from '@velcro/common';
import * as Monaco from 'monaco-editor';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { EditorManagerContext } from '../lib/EditorManager';
import { States, trackMonaco } from '../velcro';

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
  width: ${(props) => (props.total ? `${Math.round((100 * props.completed) / props.total)}%` : 0)};
  left: 0;
  height: ${(props) => (props.total ? '2px' : '0')};
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
  opacity: ${(props) => (props.isInternal ? 0.7 : 1.0)};
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
  return (
    <PreviewMessageErrorText isInternal={line.isInternal}>{line.text}</PreviewMessageErrorText>
  );
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

const Preview: React.FC<{ className?: string }> = (props) => {
  const editorManager = useContext(EditorManagerContext);
  const previewWrapRef = useRef<HTMLDivElement | null>(null);
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const [buildState, setBuildState] = useState<States>({
    stateName: 'idle',
  });
  const [buildProgress, setBuildProgress] = useState({ completed: 0, total: 0 });
  const previewHrefRef = useRef('');

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (
        previewIframeRef.current &&
        previewIframeRef.current.contentWindow === e.source &&
        e.data.event === 'click_error'
      ) {
        editorManager.focusPath(Uri.parse(e.data.entry.file).fsPath, {
          columnNumber: e.data.entry.column,
          lineNumber: e.data.entry.line,
        });
      }
    };

    window.addEventListener('message', onMessage);

    return () => window.removeEventListener('message', onMessage);
  });

  useEffect(() => {
    const monacoIntegration = trackMonaco(Monaco, {
      generateSourceMaps: 'data-uri',
      throttleBuildTimeout: 200,
    });

    monacoIntegration.onStateChange((state) => {
      setBuildState(state);

      switch (state.stateName) {
        case 'build_in_progress': {
          setBuildProgress({
            completed: state.data.completed,
            total: state.data.completed + state.data.pending,
          });
          break;
        }
        case 'build_complete': {
          console.debug(
            'Rebuild finished, build latency: %d, end-to-end latency: %d',
            state.data.end - state.data.start,
            Date.now() - state.data.start
          );

          const newHref = createPreviewUrlFromBuild(state.data);

          if (previewHrefRef.current) {
            URL.revokeObjectURL(previewHrefRef.current);
          }

          const iframe = document.createElement('iframe');
          iframe.style.display = 'none';
          iframe.src = newHref;

          if (previewWrapRef.current) {
            previewWrapRef.current.appendChild(iframe);
          }

          const onLoad = () => {
            iframe.removeEventListener('error', onError);
            iframe.style.display = '';

            if (previewIframeRef.current) {
              previewIframeRef.current.remove();
            }

            previewIframeRef.current = iframe;
          };
          const onError = () => {
            iframe.removeEventListener('load', onLoad);
            iframe.remove();
          };

          iframe.addEventListener('load', onLoad, { once: true });
          iframe.addEventListener('error', onError, { once: true });

          break;
        }
      }
    });

    return () => {
      monacoIntegration.dispose();
    };
  }, [setBuildProgress, setBuildState]);

  return (
    <PreviewWrap className={props.className}>
      {buildState.stateName === 'build_in_progress' ? (
        <PreviewProgress
          completed={buildProgress.completed}
          total={buildProgress.total}
        ></PreviewProgress>
      ) : null}
      <PreviewIframeWrap ref={previewWrapRef}></PreviewIframeWrap>
      <PreviewMessages>
        {buildState.stateName === 'build_error' ? (
          <PreviewMessage
            message={{ lines: [{ isInternal: true, text: buildState.data.error }] }}
          ></PreviewMessage>
        ) : null}
      </PreviewMessages>
    </PreviewWrap>
  );
};

export default styled(Preview)``;

function createPreviewUrlFromBuild({ code, sourceMap }: States.BuildComplete['data']) {
  code = `${code}\n\n${[Uri.file('/index.jsx')]
    .map((entrypoint) => `Velcro.runtime.require(${JSON.stringify(entrypoint.toString())});`)
    .join('\n')}\n`;
  if (sourceMap) {
    code += `\n//# sourceMappingURL=${sourceMap}`;
  }

  const markup = new File(
    [
      `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="ie=edge">
<script src="https://cdn.jsdelivr.net/npm/panic-overlay/build/panic-overlay.browser.js"></script>
<title>Document</title>
</head>
<body>
<div id="root"></div>
<script>${code.replace(/<\/(script|style)/gi, '<\\/$1').replace(/<!--/g, '\\x3C!--')}</script>
<script>
panic.configure ({
stackEntryClicked (entry) {
if (window.parent) {
  window.parent.postMessage({
    event: 'click_error',
    entry: {
      column: entry.column,
      file: entry.file,
      line: entry.line,
    }
  });
}
}
})
</script>
</body>
</html>`.trim(),
    ],
    Uri.file('/index.html').toString(),
    {
      type: 'text/html',
    }
  );

  return URL.createObjectURL(markup);
}
