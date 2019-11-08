import React, { useState, useMemo } from 'react';
import styled from '@emotion/styled/macro';
import { Portal } from 'reakit/portal';

export const NotificationsContext = React.createContext([] as Notification[]);

// const NotificationsProvider: React.FC = () => {
//   const [notifications, setNotifications] = useMemo(() => ({

//   }));

//   return <NotificationsContext.Provider value={}
// }

const NotificationsWrapper = styled.div`
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

export function useNotifications() {
  const [notifications, setNotifications] = useState([] as Notification[]);
}

export const Notifications: React.FC = () => {
  return <Portal>{/* <NotificationsWrapper>{notifications.map(notification => {})}</NotificationsWrapper> */}</Portal>;
};
