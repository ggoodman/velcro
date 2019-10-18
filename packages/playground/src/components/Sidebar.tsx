import styled from '@emotion/styled/macro';
import * as Monaco from 'monaco-editor';
import React, { useContext, useRef } from 'react';
import { useDirectory, EntryKind } from '../lib/hooks';
import { useActiveModel, EditorManagerContext } from '../lib/EditorManager';

const Entry = styled.div<{ modelFocused: boolean }>`
  background-color: ${props => (props.modelFocused ? '#008cba' : 'inherit')};
  text-decoration: none;
  color: ${props => (props.modelFocused ? '#fff' : '#262626')};

  height: 25px;
  padding: 0 0 0 8px;
  display: flex;
  align-items: center;

  ${props =>
    props.modelFocused
      ? {
          ':hover': {
            color: '#f5f5f5',
            cursor: 'pointer',
          },
        }
      : {
          ':hover': {
            backgroundColor: '#eee',
            color: '#262626',
            cursor: 'pointer',
          },
        }}
`;

const SidebarFile: React.FC<{ className?: string; model: Monaco.editor.ITextModel }> = ({ className, model }) => {
  const activeModel = useActiveModel();
  const editorManager = useContext(EditorManagerContext);

  return (
    <Entry className={className} modelFocused={model === activeModel} onClick={() => editorManager.focusModel(model)}>
      {model.uri.fsPath.slice(1)}
    </Entry>
  );
};

const Sidebar: React.FC<{ className?: string }> = props => {
  const rootDir = useRef(Monaco.Uri.file('/'));
  const entries = useDirectory(rootDir.current);

  return (
    <div className={props.className}>
      {entries.map(entry =>
        entry.type === EntryKind.Directory ? (
          <div>{entry.uri.fsPath.slice(1)}</div>
        ) : (
          <SidebarFile key={entry.uri.toString(true)} model={entry.model}>
            {entry.uri.fsPath.slice(1)}
          </SidebarFile>
        )
      )}
    </div>
  );
};

export default styled(Sidebar)`
  display: flex;
  flex-direction: column;
`;
