import React, { useEffect, useState } from 'react';
import styled from '@emotion/styled/macro';
import * as Monaco from 'monaco-editor';

import Editor from './Editor';
import Preview from './Preview';
import Sidebar from './Sidebar';
import { EditorContext } from '../lib/context';
import { useFocusedModelWithEditor } from '../lib/hooks';

const App: React.FC<{ className?: string; initialPath: string; project: Record<string, string> }> = ({
  className,
  initialPath,
  project,
}) => {
  const [editor, setEditor] = useState<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const [, focusModel] = useFocusedModelWithEditor(editor);

  useEffect(() => {
    for (const pathname in project) {
      Monaco.editor.createModel(
        project[pathname],
        pathname.match(/\.[j|t]sx?$/) ? 'typescript' : undefined,
        Monaco.Uri.file(pathname)
      );
    }

    return () => {
      for (const model of Monaco.editor.getModels()) {
        model.dispose();
      }
    };
  }, [project]);

  useEffect(() => {
    if (editor) {
      const model = Monaco.editor.getModel(Monaco.Uri.file(initialPath));

      focusModel(model);
    }
  }, [editor, focusModel, initialPath]);

  return (
    <div className={className}>
      <EditorContext.Provider value={editor}>
        <Sidebar></Sidebar>
        <Editor onSetEditor={setEditor}></Editor>
        <Preview></Preview>
      </EditorContext.Provider>
    </div>
  );
};

export default styled(App)`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  overflow: hidden;
  display: flex;
  flex-direction: row;

  ${Sidebar} {
    flex: 0 1 20%;
    min-width: 200px;
    border-right: 1px solid #ccc;
  }

  ${Editor} {
    border-right: 1px solid #ccc;
  }

  ${Editor}, ${Preview} {
    flex: 1;
  }
`;
