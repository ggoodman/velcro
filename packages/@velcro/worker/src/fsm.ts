import { DisposableStore, Emitter, Event, IDisposable } from '@velcro/common';

export type DefineEvent<TEventName extends string, TData = never> = {
  eventName: TEventName;
  data: TData;
};
type AnyEvent = DefineEvent<string> | DefineEvent<string, unknown>;
type EventWithData<TEvent extends AnyEvent> = TEvent extends AnyEvent
  ? [TEvent['data']] extends [never]
    ? never
    : TEvent
  : never;
type EventWithoutData<TEvent extends AnyEvent> = Exclude<TEvent, EventWithData<TEvent>>;

export type DefineState<TStateName extends string, TData = never> = TStateName extends string
  ? [TData] extends [never]
    ? {
        stateName: TStateName;
      }
    : {
        stateName: TStateName;
        data: TData;
      }
  : never;
type AnyState = DefineState<string> | DefineState<string, unknown>;

type Chart<TState extends AnyState, TEvent extends AnyEvent> = {
  [TStateName in TState['stateName']]: {
    onEnter?(ctx: {
      event: TEvent;
      registerDisposable(disposable: IDisposable): void;
      sendEvent: SendEventFunction<TEvent>;
      state: Extract<TState, { stateName: TStateName }>;
      transitionTo: TransitionToFunction<TState, TEvent>;
    }): void;
    onEvent?: {
      [TEventName in TEvent['eventName']]?: (ctx: {
        event: Extract<TEvent, { eventName: TEventName }>;
        registerDisposable(disposable: IDisposable): void;
        sendEvent: SendEventFunction<TEvent>;
        state: Extract<TState, { stateName: TStateName }>;
        transitionTo: TransitionToFunction<TState, TEvent>;
      }) => void;
    };
    onExit?(ctx: { event: TEvent; state: Extract<TState, { stateName: TStateName }> }): void;
  };
};

interface SendEventFunction<TEvent extends AnyEvent> {
  <TSentEvent extends EventWithoutData<TEvent>>(eventName: TSentEvent['eventName']): void;
  <TSentEvent extends EventWithData<TEvent>>(
    eventName: TSentEvent['eventName'],
    data: TSentEvent['data']
  ): void;
}

interface TransitionToFunction<TState extends AnyState, TEvent extends AnyEvent> {
  <TTargetState extends TState, TTriggeringEvent extends TEvent>(
    state: TTargetState,
    event: TTriggeringEvent
  ): void;
}

export class FSM<TState extends AnyState, TEvent extends AnyEvent> {
  private readonly onStateChangeEmitter = new Emitter<Readonly<TState>>();

  private readonly states: Chart<TState, TEvent>;
  private handlingEvents = false;
  private mutableState: TState;
  private pendingExternalEvents: TEvent[] = [];
  private pendingInternalEvents: TEvent[] = [];
  private readonly stateDisposer = new DisposableStore();

  constructor(states: Chart<TState, TEvent>, initialState: TState) {
    this.states = states;
    this.mutableState = initialState;
  }

  get onStateChange(): Event<Readonly<TState>> {
    return this.onStateChangeEmitter.event;
  }

  get state(): Readonly<TState> {
    return this.mutableState;
  }

  sendEvent<TSentEvent extends EventWithoutData<TEvent>>(event: TSentEvent['eventName']): void;
  sendEvent<TSentEvent extends EventWithData<TEvent>>(
    event: TSentEvent['eventName'],
    data: TSentEvent['data']
  ): void;
  sendEvent<TSentEvent extends TEvent>(
    eventName: TSentEvent['eventName'],
    data?: TSentEvent['data']
  ): void {
    // console.group();
    // console.log('sendEvent(%s, %s)', this.state.stateName, eventName, data);
    this.pendingExternalEvents.push({ eventName, data } as TEvent);

    if (!this.handlingEvents) {
      this.processEvents();
    }
  }

  private processEvents() {
    if (this.handlingEvents) {
      throw new Error(
        'Invariant violation: processEvents should never be called while already processing events.'
      );
    }

    this.handlingEvents = true;

    while (this.pendingExternalEvents.length || this.pendingInternalEvents.length) {
      while (this.pendingInternalEvents.length) {
        const event = this.pendingInternalEvents.shift() as TEvent;
        const currentStateDef = this.states[this.mutableState.stateName as TState['stateName']];

        if (currentStateDef.onEvent) {
          const handler = currentStateDef.onEvent[event.eventName as TEvent['eventName']];
          const state = this.state;

          if (handler) {
            handler({
              event: event as any,
              registerDisposable: this.stateDisposer.add.bind(this.stateDisposer),
              sendEvent: this.sendEventInternal.bind(this),
              state: state as any,
              transitionTo: this.transitionTo.bind(this),
            });
          }
        }
      }

      while (this.pendingExternalEvents.length) {
        // Move external events into the internal event queue for the next tick
        // of the outer loop.
        this.pendingInternalEvents.push(this.pendingExternalEvents.pop()!);
      }
    }

    this.handlingEvents = false;
  }

  private sendEventInternal<TSentEvent extends EventWithoutData<TEvent>>(
    event: TSentEvent['eventName']
  ): void;
  private sendEventInternal<TSentEvent extends EventWithData<TEvent>>(
    event: TSentEvent['eventName'],
    data: TSentEvent['data']
  ): void;
  private sendEventInternal<TSentEvent extends TEvent>(
    eventName: TSentEvent['eventName'],
    data?: TSentEvent['data']
  ): void {
    this.pendingInternalEvents.push({ eventName, data } as TEvent);

    if (!this.handlingEvents) {
      this.processEvents();
    }
  }

  private transitionTo<TTargetState extends TState, TTriggeringEvent extends TEvent>(
    state: TTargetState,
    event: TTriggeringEvent
  ) {
    const fromStateConfig = this.states[this.mutableState.stateName as TState['stateName']];
    const nextStateConfig = this.states[state.stateName as TState['stateName']];
    const fromState = { ...this.mutableState };

    this.mutableState = { ...state };
    this.onStateChangeEmitter.fire(this.state);

    if (state.stateName !== fromState.stateName) {
      this.stateDisposer.clear();

      if (fromStateConfig.onExit) {
        fromStateConfig.onExit({
          event,
          state: state as any,
        });
      }

      if (nextStateConfig.onEnter) {
        nextStateConfig.onEnter({
          event,
          registerDisposable: this.stateDisposer.add.bind(this.stateDisposer),
          sendEvent: this.sendEventInternal.bind(this),
          state: state as any,
          transitionTo: this.transitionTo.bind(this),
        });
      }
    }
  }
}
