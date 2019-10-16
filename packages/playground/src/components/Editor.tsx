import styled from '@emotion/styled/macro';
import * as Monaco from 'monaco-editor';
import React, { useRef, useEffect } from 'react';

const Editor: React.FC<{
  className?: string;
  onSetEditor(editor: Monaco.editor.IStandaloneCodeEditor): void;
}> = ({ className, onSetEditor }) => {
  const el = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!el.current) {
      return;
    }

    const newEditor = Monaco.editor.create(el.current, {
      model: null,
    });

    onSetEditor(newEditor);

    return () => newEditor.dispose();
  }, [el, onSetEditor]);

  return <div className={className} ref={el}></div>;
};

export default styled(Editor)``;
