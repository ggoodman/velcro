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
  flex-direction: row;
  align-items: center;

  & > span {
    flex: 1;
  }

  & > button {
    display: none;
  }

  &:hover > button {
    display: block;
  }

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

const CreateEntry = styled.div`
  text-decoration: none;
  color: '#262626';

  height: 25px;
  padding: 0 0 0 8px;
  display: flex;
  align-items: center;

  :hover {
    background-color: #eee;
    cursor: pointer;
  }
`;

const SidebarFileDelete = styled.button`
  border: none;
  background: none;
`;

const SidebarFile: React.FC<{ className?: string; model: Monaco.editor.ITextModel }> = ({ className, model }) => {
  const activeModel = useActiveModel();
  const editorManager = useContext(EditorManagerContext);

  const onClickDelete = () => {
    model.dispose();
  };

  return (
    <Entry className={className} modelFocused={model === activeModel}>
      <span onClick={() => editorManager.focusModel(model)}>{model.uri.fsPath.slice(1)}</span>
      <SidebarFileDelete onClick={() => onClickDelete()}>❌</SidebarFileDelete>
    </Entry>
  );
};

const Sidebar: React.FC<{ className?: string }> = props => {
  const rootDir = useRef(Monaco.Uri.file('/'));
  const entries = useDirectory(rootDir.current);
  const editorManager = useContext(EditorManagerContext);

  const onClickCreate = () => {
    const filename = prompt('Filename?');

    if (filename) {
      editorManager.createModel(filename);
    }
  };

  return (
    <div className={props.className}>
      {entries.map(entry =>
        entry.type === EntryKind.Directory ? (
          <div>{entry.uri.fsPath.slice(1)}</div>
        ) : (
          <SidebarFile key={entry.uri.toString(true)} model={entry.model}></SidebarFile>
        )
      )}
      <CreateEntry onClick={() => onClickCreate()}>Create...</CreateEntry>
    </div>
  );
};

export default styled(Sidebar)`
  display: flex;
  flex-direction: column;
`;
