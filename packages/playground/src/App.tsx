import { Global, css } from '@emotion/core';
import styled from '@emotion/styled/macro';
import CssBaseline from '@material-ui/core/CssBaseline';
import { OfflineBolt, Update } from '@material-ui/icons';
import React from 'react';
import { Tooltip, TooltipReference, useTooltipState } from 'reakit/Tooltip';

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
  background: #008cba;
  margin: 0 0.5em;
  color: white;
  border-radius: 2px;
  font-weight: 600;

  :hover {
    cursor: pointer;
    text-decoration: underline;
  }
`;

const StyledTooltip = styled.div`
  font-family: Open Sans, Helvetica Neue, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.4;
  background-color: #333;
  color: #fff;
  border-radius: 4px;
  opacity: 0.9;
  padding: 0.2em 0.4em;
`;

const StatusBar: React.FC = () => {
  const serviceWorker = useServiceWorker();
  const offlineTooltip = useTooltipState({ gutter: 0 });
  const reloadTooltip = useTooltipState({ gutter: 0 });

  return (
    <StatusBarStyles>
      {serviceWorker.assetsCached ? (
        <TooltipReference {...offlineTooltip} as={StatusBarItem}>
          <OfflineBolt color="inherit" fontSize="small" />
          &nbsp;Offline ready
        </TooltipReference>
      ) : null}
      <Tooltip {...offlineTooltip} as={StyledTooltip}>
        This application has been fully cached and can now be used offline.
      </Tooltip>

      {serviceWorker.assetsUpdateReady ? (
        <TooltipReference {...reloadTooltip} as={StatusBarItem}>
          <Update color="inherit" fontSize="small" />
          &nbsp;Update ready:
          <ReloadButton onClick={() => serviceWorker.updateAssets()}>Reload</ReloadButton>
        </TooltipReference>
      ) : null}
      <Tooltip {...reloadTooltip} as={StyledTooltip}>
        There is an update of this application ready to install. Click install reload to install the update and reload
        the page.
      </Tooltip>
    </StatusBarStyles>
  );
};

const StatusBarStyles = styled.div`
  display: flex;
  flex-direction: row;

  font-size: 90%;

  height: 24px;
  padding: 0 0.5em;

  ${StatusBarItem} {
    margin-left: 0.5em;
    margin-right: 0.5em;
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
    background: #f5f5f5;
    border-radius: 2px;
    box-shadow: 0 10px 20px rgba(0, 0, 0, 0.19), 0 6px 6px rgba(0, 0, 0, 0.23);

    ${StatusBarStyles} {
    }
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
  @import url('https://fonts.googleapis.com/css?family=Raleway:900&display=swap');

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
`;

export const App: React.FC = () => {
  return (
    <ServiceWorkerProvider>
      <CssBaseline />
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
