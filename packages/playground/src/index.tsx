import styled from '@emotion/styled';
import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { Button } from 'reakit/Button';
import { useDialogState, Dialog } from 'reakit/Dialog';
import { Portal } from 'reakit/Portal';
// import 'modern-css-reset';

import App from './components/App';
import * as serviceWorker from './serviceWorker';

const project = {
  'package.json':
    JSON.stringify(
      {
        dependencies: {
          '@emotion/core': '^10.0.17',
          '@emotion/styled': '^10.0.17',
          'github-markdown-css': '^3.0.1',
          react: '^16.9.0',
          'react-dom': '^16.9.0',
        },
      },
      null,
      2
    ) + '\n',
  'explanation.jsx':
    `
import React from 'react';

export const Explanation = () => <>
  <section>
    <h2>What is this?</h2>
    <p>
      This is a demo of bundling and serving a browser-based sandbox fully from the browser. <strong>There are <em>no</em> servers involved</strong> except the static server hosting this demo and <a href="https://unpkg.com" target="_blank" rel="noopener">unpkg.com</a>. All module resolution, transpilation and bundling is happening in the browser.
    </p>
    <p>
      Try it. Go offline, and reload...
    </p>
    <p>
      <strong>I dare you.</strong>
    </p>
  </section>
  <section>
    <h2>Features</h2>
    <ul>
      <li>Full offline support. Once your cache is seeded, you can cut the cord.</li>
      <li>Fully browser-based bundling.</li>
      <li>Add (almost) any node module and no server is involved.</li>
      <li>If you want to add another module, make sure to add it to <code>package.json</code> first.</li>
      <li>Automatic type acquisition for full typings support in the browser, in JavaScript!</li>
      <li>Resolve source locations in stack traces</li>
      <li>Hot module reloading</li>
    </ul>
  </section>
</>;
    `.trim() + '\n',
  'index.jsx':
    `
import React, { Component } from 'react';
import ReactDOM from 'react-dom';

import 'github-markdown-css';
import './style.css';

import { Explanation } from './explanation';
import { name } from './name';

class Hello extends Component {
  render() {
    return <div className="markdown-body">
      <h1>Hello {this.props.toWhat}</h1>
      <blockquote>There is no <del>spoon</del> server</blockquote>
      <Explanation/>
    </div>;
  }
}
  
ReactDOM.render(
  <Hello toWhat={ name } />,
  document.getElementById('root')
);
      `.trim() + '\n',
  'name.js':
    `
export const name = 'Velcro';
    `.trim() + '\n',
  'style.css':
    `
.markdown-body {
  box-sizing: border-box;
  min-width: 200px;
  max-width: 980px;
  margin: 0 auto;
  padding: 45px;
}

@media (max-width: 767px) {
  .markdown-body {
    padding: 15px;
  }
}
    `.trim() + '\n',
};

const AppWrap = styled.div`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;

  background: #333;

  ${App} {
    flex: 0 0 80vh;
    width: 80vw;
    background: white;
    box-shadow: 0 10px 20px rgba(0, 0, 0, 0.19), 0 6px 6px rgba(0, 0, 0, 0.23);
    max-height: 90vh;
  }
`;

const Notifications = styled.div`
  font-family: Open Sans, Helvetica Neue, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.4;
  color: #222;

  display: flex;
  flex-direction: column;
  position: absolute;
  right: 0;
  bottom: 0;
  padding: 8px;

  & > * {
    box-shadow: 0 19px 38px rgba(0, 0, 0, 0.3), 0 15px 12px rgba(0, 0, 0, 0.22);
    max-width: 200px;
    margin: 8px;
  }
`;

const AlertDialog = styled(Dialog)`
  background-color: white;
  padding: 0.5em 1em;
  border-radius: 4px;

  & > p {
    margin: 0;
  }
`;

const OnlineNotification: React.FC<{ notification: ServiceWorkerOnine; onDismiss: () => void }> = ({ onDismiss }) => {
  const dialog = useDialogState({ visible: true });

  return (
    <AlertDialog
      {...dialog}
      hideOnClickOutside={false}
      hideOnEsc={false}
      modal={false}
      role="alertdialog"
      aria-label="This application is ready for offline usage"
    >
      <p>This application is ready for offline usage</p>
      <Button onClick={onDismiss}>Hide</Button>
    </AlertDialog>
  );
};

const UpdatedNotification: React.FC<{ notification: ServiceWorkerUpdated; onDismiss: () => void }> = ({
  notification,
  onDismiss,
}) => {
  const dialog = useDialogState({ visible: true });

  const onClickUpdate = () => {
    const waitingServiceWorker = notification.registration.waiting;

    interface ServiceWorkerEvent extends Event {
      target: Partial<ServiceWorker> & EventTarget | null;
    }

    if (waitingServiceWorker) {
      waitingServiceWorker.addEventListener('statechange', (event: ServiceWorkerEvent) => {
        if (event.target && event.target.state === 'activated') {
          window.location.reload();
        }
      });
      waitingServiceWorker.postMessage({ type: 'SKIP_WAITING' });
    }
  };

  return (
    <AlertDialog {...dialog} modal={false} role="alertdialog" aria-label="A new version of this application is ready">
      <p>A new version of this application is ready</p>
      <Button onClick={onDismiss}>Cancel</Button>
      <Button onClick={onClickUpdate}>Update</Button>
    </AlertDialog>
  );
};

interface ServiceWorkerOnine {
  type: 'online';
  registration: ServiceWorkerRegistration;
}

interface ServiceWorkerUpdated {
  type: 'updated';
  registration: ServiceWorkerRegistration;
}

type ServiceWorkerNotification = ServiceWorkerOnine | ServiceWorkerUpdated;

const ServiceWorkerLifecycle: React.FC = props => {
  const [notifications, setNotifications] = useState([] as ServiceWorkerNotification[]);

  useEffect(() => {
    serviceWorker.register({
      onSuccess(registration) {
        const newNotifications = notifications.filter(n => n.type !== 'online');

        newNotifications.push({ type: 'online', registration });
        setNotifications(newNotifications);
      },
      onUpdate(registration) {
        const newNotifications = notifications.filter(n => n.type !== 'updated');

        newNotifications.push({ type: 'updated', registration });
        setNotifications(newNotifications);
      },
    });
  });

  const removeNotification = (notification: ServiceWorkerNotification) => {
    const idx = notifications.indexOf(notification);

    if (idx !== -1) {
      const newNotifications = notifications.slice();

      newNotifications.splice(idx, 1);

      setNotifications(newNotifications);
    }
  };

  return (
    <>
      <Portal>
        <Notifications>
          {notifications.map((notification, i) => {
            switch (notification.type) {
              case 'online':
                return (
                  <OnlineNotification
                    key={i}
                    notification={notification}
                    onDismiss={() => removeNotification(notification)}
                  ></OnlineNotification>
                );
              case 'updated':
                return (
                  <UpdatedNotification
                    key={i}
                    notification={notification}
                    onDismiss={() => removeNotification(notification)}
                  ></UpdatedNotification>
                );
            }

            return undefined;
          })}
        </Notifications>
      </Portal>
      {props.children}
    </>
  );
};

ReactDOM.render(
  <ServiceWorkerLifecycle>
    <AppWrap>
      <App initialPath="index.jsx" project={project} />
    </AppWrap>
  </ServiceWorkerLifecycle>,
  document.getElementById('root')
);
