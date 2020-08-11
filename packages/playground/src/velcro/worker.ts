/* eslint-env webworker */

///<reference lib="webworker" />

import { VelcroBuilderServer } from './server';
import { wireBuilderStateChanges, wireWorkerEventsToServer } from './wireWorker';

const server = new VelcroBuilderServer();

wireWorkerEventsToServer(globalThis, server);
wireBuilderStateChanges(server, globalThis, { debounceInterval: 16 });
