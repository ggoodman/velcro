import React from 'react';

import * as serviceWorker from './serviceWorker';

interface ServiceWorkerEvent extends Event {
  target: Partial<ServiceWorker> & EventTarget | null;
}

interface ServiceWorkerContextValue {
  assetsUpdateReady: boolean;
  assetsCached: boolean;
  updateAssets(): void;
}

const ServiceWorkerContext = React.createContext<ServiceWorkerContextValue>({
  assetsCached: false,
  assetsUpdateReady: false,
  updateAssets() {
    throw new Error(`Attempting to update assets outside of the ServiceWorkerContext`);
  },
});

export function ServiceWorkerProvider(props: React.PropsWithChildren<{}>) {
  const [waitingServiceWorker, setWaitingServiceWorker] = React.useState<ServiceWorker | null>(null);
  const [assetsUpdateReady, setAssetsUpdateReady] = React.useState(false);
  const [assetsCached, setAssetsCached] = React.useState(false);

  const value = React.useMemo(
    () => ({
      assetsUpdateReady,
      assetsCached,
      // Call when the user confirm update of application and reload page
      updateAssets: () => {
        if (waitingServiceWorker) {
          waitingServiceWorker.addEventListener('statechange', (event: ServiceWorkerEvent) => {
            if (event.target && event.target.state === 'activated') {
              window.location.reload();
            }
          });

          waitingServiceWorker.postMessage({ type: 'SKIP_WAITING' });
        }
      },
    }),
    [assetsUpdateReady, assetsCached, waitingServiceWorker]
  );

  // Once on component mounted subscribe to Update and Succes events in
  // CRA's service worker wrapper
  React.useEffect(() => {
    serviceWorker.register({
      onUpdate: registration => {
        setWaitingServiceWorker(registration.waiting);
        setAssetsUpdateReady(true);
      },
      onSuccess: () => {
        setAssetsCached(true);
      },
    });
  }, []);

  return <ServiceWorkerContext.Provider value={value} {...props} />;
}

export function useServiceWorker() {
  const context = React.useContext(ServiceWorkerContext);

  if (!context) {
    throw new Error('useServiceWorker must be used within a ServiceWorkerProvider');
  }

  return context;
}
