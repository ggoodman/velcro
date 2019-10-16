import styled from '@emotion/styled/macro';
import * as Monaco from 'monaco-editor';
import React, { useEffect, useState } from 'react';
import { useFocusedModel } from '../lib/hooks';

const Entry = styled.div<{ focused: boolean }>`
  background-color: ${props => (props.focused ? 'yellow' : 'inherit')};
`;

const Sidebar: React.FC<{ className?: string }> = props => {
  const [focusedModel, focusModel] = useFocusedModel();
  const [models, setModels] = useState(Monaco.editor.getModels());

  useEffect(() => {
    const onDidCreateDisposable = Monaco.editor.onDidCreateModel(model => {
      models.push(model);

      setModels(models);
    });
    const onWillDisposeDisposable = Monaco.editor.onWillDisposeModel(model => {
      const idx = models.indexOf(model);

      if (idx >= 0) {
        models.splice(idx, 1);
        setModels(models);
      }
    });

    return () => {
      onDidCreateDisposable.dispose();
      onWillDisposeDisposable.dispose();
    };
  }, [models]);

  return (
    <div className={props.className}>
      {models.map(model => (
        <Entry focused={focusedModel === model} key={model.uri.toString(true)} onClick={() => focusModel(model)}>
          {model.uri.fsPath.slice(1)}
        </Entry>
      ))}
    </div>
  );
};

export default styled(Sidebar)``;
