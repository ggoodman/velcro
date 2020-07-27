import styled from '@emotion/styled/macro';
import React, { useEffect } from 'react';

import Editor from './Editor';
import Preview from './Preview';
import Sidebar from './Sidebar';
import { EditorManager, EditorManagerContext } from '../lib/EditorManager';
import { ITemplate } from '../templates';

const PlaygroundCmp: React.FC<{
  className?: string;
  templates: ITemplate[];
}> = ({ className, templates }) => {
  const template = templates[0];
  const editorManager = new EditorManager({
    files: template.files,
    initialPath: template.defaultFile,
  });

  const onChangeTemplate = (template: ITemplate) => {
    editorManager.loadProject(template.files, template.defaultFile);
  };

  return (
    <div className={className}>
      <EditorManagerContext.Provider value={editorManager}>
        <Sidebar templates={templates} onChangeTemplate={onChangeTemplate}></Sidebar>
        <Editor></Editor>
        <Preview></Preview>
      </EditorManagerContext.Provider>
    </div>
  );
};

export const Playground = styled(PlaygroundCmp)`
  display: flex;
  flex-direction: row;

  font-family: Open Sans, Helvetica Neue, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.4;

  color: #222;

  ${Sidebar} {
    flex: 1 1 100px;
    min-width: 100px;
    max-width: 400px;
    border-right: 1px solid #ccc;
  }

  ${Editor} {
    border-right: 1px solid #ccc;
  }

  ${Editor}, ${Preview} {
    flex: 10;
  }
`;
