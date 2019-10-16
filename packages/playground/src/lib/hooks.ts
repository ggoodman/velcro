import * as Monaco from 'monaco-editor';
import { useEffect, useState, useContext } from 'react';

import { EditorContext } from './context';

export function useFocusedModelWithEditor(editor: Monaco.editor.IStandaloneCodeEditor | null) {
  const [focusedModel, setFocusedModel] = useState<Monaco.editor.ITextModel | null>(editor ? editor.getModel() : null);

  useEffect(() => {
    if (editor) {
      const onDidBlurEditorTextDisposable = editor.onDidBlurEditorText(() => {
        setFocusedModel(null);
      });
      const onDidFocusEditorTextDisposable = editor.onDidFocusEditorText(() => {
        setFocusedModel(editor.getModel());
      });

      return () => {
        onDidBlurEditorTextDisposable.dispose();
        onDidFocusEditorTextDisposable.dispose();
      };
    }
  }, [editor]);

  const focusModel = (model: Monaco.editor.ITextModel | null) => {
    if (editor) {
      editor.setModel(model);
      editor.focus();
    }
  };

  return [focusedModel, focusModel] as const;
}

export function useFocusedModel() {
  const editor = useContext(EditorContext);

  return useFocusedModelWithEditor(editor);
}
