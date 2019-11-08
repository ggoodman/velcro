import { Global, css } from '@emotion/core';
import styled from '@emotion/styled/macro';
import { OfflineBolt, Update } from '@material-ui/icons';
import 'modern-css-reset';
import React from 'react';

import { Playground } from './playground';
import { files } from './templates/react';
import { useServiceWorker, ServiceWorkerProvider } from './useServiceWorker';
import { Button } from 'reakit/Button';

const PlaygroundWrapper = styled.div`
  background: white;
  color: #666;
  display: flex;
  flex-direction: column;

  ${Playground} {
    border-bottom: 1px solid #ccc;
    flex: 1;
  }
`;

const StatusBarItem = styled.span`
  display: inline-flex;
  flex-direction: row;
  align-items: center;
`;

const ReloadButton = styled(Button)`
  border: 0;
  background: transparent;
  margin: 0;
  padding: 0 0.2em;

  :hover {
    cursor: pointer;
    text-decoration: underline;
  }
`;

const StatusBar: React.FC = () => {
  const foo = useServiceWorker();

  return (
    <StatusBarStyles>
      {foo.assetsCached ? (
        <StatusBarItem>
          <OfflineBolt color="inherit" /> Offline ready
        </StatusBarItem>
      ) : null}
      {foo.assetsUpdateReady || true ? (
        <StatusBarItem>
          <Update color="inherit" /> Update ready:
          <ReloadButton onClick={() => foo.updateAssets()}>Reload now</ReloadButton>
        </StatusBarItem>
      ) : null}
    </StatusBarStyles>
  );
};

const StatusBarStyles = styled.div`
  display: flex;
  flex-direction: row;

  font-size: 90%;

  height: 24px;

  ${StatusBarItem} {
    margin-left: 0.5em;

    :first {
      margin-left: 0;
    }
  }
`;

const AppWrapper = styled.div`
  width: 100%;
  min-width: 200px;
  max-width: 80vw;
  margin: 0 auto;
  padding: 0 0 45px 0;

  @media (max-width: 960px) {
    padding: 0 15px 15px 15px;
    max-width: initial;
  }

  display: flex;
  flex-direction: column;

  ${PlaygroundWrapper} {
    flex: 1;
    border-radius: 2px;
    box-shadow: 0 10px 20px rgba(0, 0, 0, 0.19), 0 6px 6px rgba(0, 0, 0, 0.23);
  }

  ${StatusBarStyles} {
    background: #f5f5f5;
  }
`;

const Title = styled.div`
  font-family: 'Raleway', sans-serif;
  font-size: 250%;
  font-weight: 800;
  font-variant: small-caps;
  font-variant-caps: small-caps;
  color: #00bfff;
`;

const Subtitle = styled.div`
  color: #ddd;
  font-size: 120%;
  font-weight: 400;
`;

const Link = styled.a`
  color: white;
  text-decoration: none;

  :hover {
    text-decoration: underline;
  }
`;

const Links = styled.div`
  display: flex;
  flex-direction: row;

  & > *:not(:last-child):after {
    padding: 0 0.5em;
    content: '｜';
    color: #aaa;
    text-decoration: none;
  }

  ${Link} {
    color: #ccc;
  }
`;

const Header = styled.div`
  display: flex;
  flex-direction: row;
  align-items: baseline;
  padding: 0.8em 0 0.3em 0;
  text-shadow: #000 1px 1px 5px;

  ${Title} {
    margin-right: 0.5em;
  }

  ${Subtitle} {
    margin-right: 0.5em;
  }

  ${Links} {
    flex: 1;
    justify-content: flex-end;
  }
`;

const globalCss = css`
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  html,
  body {
    margin: 0;
    padding: 0;
    min-height: 100vh;

    font-family: Open Sans, Helvetica Neue, Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.4;

    background: #333;
    color: #fff;

    display: flex;
    flex-direction: column;

    #root {
      flex: 1;
      display: flex;
      flex-direction: column;

      ${AppWrapper} {
        flex: 1;
      }
    }
  }

  @import url('https://fonts.googleapis.com/css?family=Raleway:900&display=swap');
`;

export const App: React.FC = () => {
  return (
    <ServiceWorkerProvider>
      <AppWrapper>
        <Global styles={globalCss}></Global>
        <Header>
          <Title>Velcro</Title>
          <Subtitle>The client-side bundler and playground</Subtitle>
          <Links>
            <div>
              <Link href="https://twitter.com/filearts" target="_blank" rel="nofollow noreferrer">
                @filearts
              </Link>
            </div>
            <div>
              <Link href="https://github.com/ggoodman/velcro" target="_blank" rel="nofollow noreferrer">
                View on GitHub
              </Link>
            </div>
          </Links>
        </Header>
        <PlaygroundWrapper>
          <Playground project={files} initialPath="index.jsx"></Playground>
          <StatusBar></StatusBar>
        </PlaygroundWrapper>
      </AppWrapper>
    </ServiceWorkerProvider>
  );
};
