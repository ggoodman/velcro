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

const ServiceWorkerContext = React.createContext<ServiceWorkerContextValue | undefined>(undefined);

export function ServiceWorkerProvider(props: React.PropsWithChildren<{}>) {
  const [waitingServiceWorker, setWaitingServiceWorker] = React.useState<ServiceWorker | null>(null);
  const [assetsUpdateReady, setAssetsUpdateReady] = React.useState(false);
  const [assetsCached, setAssetsCached] = React.useState(false);

  const value = React.useMemo(() => {
    return {
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
    };
  }, [assetsUpdateReady, assetsCached, waitingServiceWorker]);

  // Once on component mounted subscribe to Update and Succes events in
  // CRA's service worker wrapper
  React.useEffect(() => {
    serviceWorker.register({
      onUpdate: registration => {
        setWaitingServiceWorker(registration.waiting);
      },
      onUpdateAvailable: registration => {
        setAssetsUpdateReady(true);
      },
      onSuccess: registration => {
        setAssetsCached(true);
        setAssetsUpdateReady(false);

        if (registration.active) {
          registration.active.addEventListener('statechange', (event: ServiceWorkerEvent) => {
            if (!navigator.serviceWorker.controller) {
              setAssetsCached(false);
            }
          });
        }
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
