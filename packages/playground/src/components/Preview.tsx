import styled from '@emotion/styled/macro';
import { Bundler } from '@velcro/bundler';
import * as Monaco from 'monaco-editor';
import React, { useEffect, useRef } from 'react';
import { Delayer, Throttler, DisposableStore, CancellationTokenSource } from 'ts-primitives';

const Preview: React.FC<{ className?: string }> = props => {
  const invalidations = useRef(new Set<string>());
  const bundler = useRef(new Bundler({ resolver: null! }));

  useEffect(() => {
    const disposable = new DisposableStore();
    const delayer = new Delayer(500);
    const throttler = new Throttler();

    let tokenSource = new CancellationTokenSource();

    const queueRefreshPreview = (uris: string[]) => {
      tokenSource.cancel();
      tokenSource.dispose();

      tokenSource = new CancellationTokenSource();

      for (const uri of uris) {
        invalidations.current.add(uri);
      }

      delayer.trigger(() => throttler.queue(() => refreshPreview(tokenSource.token)));
    };

    const refreshPreview = async (token: Monaco.CancellationToken) => {
      console.log('refreshing the preview', invalidations.current);

      token.onCancellationRequested(() => {
        console.log('refresh cancelled');
      });

      await Promise.all(
        Array.from(invalidations.current).map(spec => {
          return bundler.current.invalidate(spec, { token });
        })
      );

      invalidations.current.clear();
    };

    disposable.add(delayer);

    disposable.add(
      Monaco.editor.onDidCreateModel(model => {
        queueRefreshPreview([model.uri.toString(true)]);

        disposable.add(
          model.onDidChangeContent(() => {
            queueRefreshPreview([model.uri.toString(true)]);
          })
        );
      })
    );

    disposable.add(
      Monaco.editor.onWillDisposeModel(model => {
        queueRefreshPreview([model.uri.toString(true)]);
      })
    );

    return () => disposable.dispose();
  }, [invalidations]);

  return <div className={props.className}>Preview</div>;
};

export default styled(Preview)`
  border-right: 1px solid #ccc;
`;
