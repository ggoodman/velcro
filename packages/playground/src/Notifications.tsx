import React from 'react';
import { Portal } from 'reakit/portal';

export const NotificationsContext = React.createContext([] as Notification[]);

// const NotificationsProvider: React.FC = () => {
//   const [notifications, setNotifications] = useMemo(() => ({

//   }));

//   return <NotificationsContext.Provider value={}
// }

export function useNotifications() {
  // const [notifications, setNotifications] = useState([] as Notification[]);
}

export const Notifications: React.FC = () => {
  return (
    <Portal>
      {/* <NotificationsWrapper>{notifications.map(notification => {})}</NotificationsWrapper> */}
    </Portal>
  );
};
