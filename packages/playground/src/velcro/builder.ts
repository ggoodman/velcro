import { States } from './states';
import { Events } from './events';
import { FSM } from './fsm';

export interface VelcroBuilder extends FSM<States, Events> {
  dispose(): void;
}
