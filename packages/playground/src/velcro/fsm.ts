import { DisposableStore, Emitter, Event, IDisposable } from '@velcro/common';

type AnyFunc = (...args: any[]) => any;

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

export type OnEnterHandlerContext<
  TState extends AnyState,
  TEvent extends AnyEvent,
  TStateName extends TState['stateName'] = TState['stateName']
> = {
  event: TEvent;
  registerDisposable(disposable: IDisposable): void;
  sendEvent: SendEventFunction<TEvent>;
  state: Extract<TState, { stateName: TStateName }>;
  transitionTo: TransitionToFunction<TState, TEvent>;
};

export type OnEnterHandlerFunction<
  TState extends AnyState,
  TEvent extends AnyEvent,
  TStateName extends TState['stateName'] = TState['stateName']
> = (ctx: OnEnterHandlerContext<TState, TEvent, TStateName>) => void;

/**
 * Conditional, mapped type that takes valid states (`TStates`), valid events (`TEvents`)
 * and actions and results in only the *names* of those actions that can be used as enter
 * handlers for the state `TStateName`.
 */
type OnEnterHandlerAction<
  TState extends AnyState,
  TEvent extends AnyEvent,
  TStateName extends TState['stateName'],
  TActions extends { [name: string]: AnyFunc }
> = {
  [TActionName in keyof TActions]: TActions[TActionName] extends OnEnterHandlerFunction<
    TState,
    TEvent,
    TStateName
  >
    ? TActionName
    : never;
}[keyof TActions];

export type OnEventHandlerContext<
  TState extends AnyState,
  TEvent extends AnyEvent,
  TEventName extends TEvent['eventName'] = TEvent['eventName'],
  TStateName extends TState['stateName'] = TState['stateName']
> = {
  event: Extract<TEvent, { eventName: TEventName }>;
  registerDisposable(disposable: IDisposable): void;
  sendEvent: SendEventFunction<TEvent>;
  state: Extract<TState, { stateName: TStateName }>;
  transitionTo: TransitionToFunction<TState, TEvent>;
};

export type OnEventHandlerFunction<
  TState extends AnyState,
  TEvent extends AnyEvent,
  TEventName extends TEvent['eventName'] = TEvent['eventName'],
  TStateName extends TState['stateName'] = TState['stateName']
> = (ctx: OnEventHandlerContext<TState, TEvent, TEventName, TStateName>) => void;

export type OnExitHandlerContext<
  TState extends AnyState,
  TEvent extends AnyEvent,
  TStateName extends TState['stateName'] = TState['stateName']
> = { event: TEvent; state: Extract<TState, { stateName: TStateName }> };

export type OnExitHandlerFunction<
  TState extends AnyState,
  TEvent extends AnyEvent,
  TStateName extends TState['stateName'] = TState['stateName']
> = (ctx: OnExitHandlerContext<TState, TEvent, TStateName>) => void;

type ChartDefinition<
  TState extends AnyState,
  TEvent extends AnyEvent,
  TActions extends { [name: string]: AnyFunc } = Record<never, AnyFunc>
> = {
  onEnter?: OnEnterHandlerFunction<TState, TEvent>;
  onEvent?: {
    [TEventName in TEvent['eventName']]?: OnEventHandlerFunction<TState, TEvent, TEventName>;
  };
  onExit?: OnExitHandlerFunction<TState, TEvent>;
  states: {
    [TStateName in TState['stateName']]: {
      onEnter?:
        | OnEnterHandlerFunction<TState, TEvent, TStateName>
        | OnEnterHandlerAction<TState, TEvent, TStateName, TActions>;
      onEvent?: {
        [TEventName in TEvent['eventName']]?: OnEventHandlerFunction<
          TState,
          TEvent,
          TEventName,
          TStateName
        >;
      };
      onExit?: OnExitHandlerFunction<TState, TEvent, TStateName>;
    };
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

export class FSM<
  TState extends AnyState,
  TEvent extends AnyEvent,
  TActions extends { [name: string]: AnyFunc } = Record<never, AnyFunc>
> {
  private readonly onEventEmitter = new Emitter<Readonly<TEvent>>();
  private readonly onStateChangeEmitter = new Emitter<Readonly<TState>>();

  private readonly actions: TActions;
  private readonly states: ChartDefinition<TState, TEvent, TActions>;
  private handlingEvents = false;
  private isDisposed = false;
  private mutableState: TState;
  private pendingExternalEvents: TEvent[] = [];
  private pendingInternalEvents: TEvent[] = [];
  private readonly stateDisposer = new DisposableStore();

  constructor(
    states: ChartDefinition<TState, TEvent, TActions>,
    initialState: TState,
    actions?: TActions
  ) {
    this.states = states;
    this.mutableState = initialState;
    this.actions = actions || ({} as TActions);
  }

  get onEvent(): Event<Readonly<TEvent>> {
    return this.onEventEmitter.event;
  }

  get onStateChange(): Event<Readonly<TState>> {
    return this.onStateChangeEmitter.event;
  }

  get state(): Readonly<TState> {
    return this.mutableState;
  }

  dispose() {
    this.stateDisposer.dispose();
    this.isDisposed = true;
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
    if (this.isDisposed) return;

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

    while (
      !this.isDisposed &&
      (this.pendingExternalEvents.length || this.pendingInternalEvents.length)
    ) {
      while (!this.isDisposed && this.pendingInternalEvents.length) {
        const event = this.pendingInternalEvents.shift() as TEvent;

        this.onEventEmitter.fire(event);

        const currentStateDef = this.states.states[
          this.mutableState.stateName as TState['stateName']
        ];

        // While the current state might not have a handler, there may be a global
        // handler.
        const handler =
          currentStateDef.onEvent?.[event.eventName as TEvent['eventName']] ||
          this.states.onEvent?.[event.eventName as TEvent['eventName']];

        if (handler) {
          const state = this.state;
          handler({
            event: event as any,
            registerDisposable: this.stateDisposer.add.bind(this.stateDisposer),
            sendEvent: this.sendEventInternal.bind(this),
            state: state as any,
            transitionTo: this.transitionTo.bind(this),
          });
        }
      }

      while (!this.isDisposed && this.pendingExternalEvents.length) {
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
    if (this.isDisposed) return;

    this.pendingInternalEvents.push({ eventName, data } as TEvent);

    if (!this.handlingEvents) {
      this.processEvents();
    }
  }

  private transitionTo<TTargetState extends TState, TTriggeringEvent extends TEvent>(
    state: TTargetState,
    event: TTriggeringEvent
  ) {
    const fromStateConfig = this.states.states[this.mutableState.stateName as TState['stateName']];
    const nextStateConfig = this.states.states[state.stateName as TState['stateName']];
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

      const onEnterDef = nextStateConfig.onEnter;

      if (onEnterDef) {
        let onEnterHandler:
          | OnEnterHandlerFunction<TState, TEvent, TState['stateName']>
          | undefined = undefined;

        if (typeof onEnterDef === 'string') {
          onEnterHandler = this.actions[onEnterDef];
        } else if (typeof onEnterDef === 'function') {
          onEnterHandler = onEnterDef;
        }

        if (!onEnterHandler) {
          // TODO: Should we warn / error?
          return;
        }

        onEnterHandler({
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
