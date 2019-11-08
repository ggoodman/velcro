import styled from '@emotion/styled/macro';
import React, { useRef, useEffect, useContext } from 'react';
import { EditorManagerContext } from '../lib/EditorManager';

const Editor: React.FC<{
  className?: string;
}> = ({ className }) => {
  const el = useRef<HTMLDivElement | null>(null);
  const editorManager = useContext(EditorManagerContext);

  useEffect(() => {
    if (!el.current) {
      return;
    }

    const editor = editorManager.mount(el.current);

    return () => {
      editor.dispose();
    };
  }, [editorManager, el]);

  return (
    <div className={className} ref={el}>
      <div></div>
    </div>
  );
};

export default styled(Editor)``;
