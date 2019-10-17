import styled from '@emotion/styled/macro';
import * as Monaco from 'monaco-editor';
import React from 'react';
import { useFocusedModel, useDirectory, EntryKind } from '../lib/hooks';

const Entry = styled.div<{ focused: boolean }>`
  background-color: ${props => (props.focused ? 'yellow' : 'inherit')};
`;

const SidebarFile: React.FC<{ className?: string; model: Monaco.editor.ITextModel }> = ({ className, model }) => {
  const [focusedModel, focusModel] = useFocusedModel();

  return (
    <Entry className={className} focused={model === focusedModel} onClick={() => focusModel(model)}>
      {model.uri.fsPath.slice(1)}
    </Entry>
  );
};

const Sidebar: React.FC<{ className?: string }> = props => {
  const rootDir = Monaco.Uri.file('/');
  const entries = useDirectory(rootDir);

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

export default styled(Sidebar)``;
