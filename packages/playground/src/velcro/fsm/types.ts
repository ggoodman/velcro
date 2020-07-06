export const foo = true;
// interface IDisposable {
//   dispose(): void;
// }

// //#region Event
// export type DefineEvent<TEventName extends string, TData = never> = {
//   eventName: TEventName;
//   data: TData;
// };
// export type AnyEvent = DefineEvent<string, unknown>;
// export type EventWithData<TEvent extends AnyEvent> = {
//   [TEventName in TEvent['eventName']]: [
//     Extract<TEvent, { eventName: TEventName }>['data']
//   ] extends [never]
//     ? never
//     : Extract<TEvent, { eventName: TEventName }>;
// }[TEvent['eventName']];
// export type EventWithoutData<TEvent extends AnyEvent> = Exclude<TEvent, EventWithData<TEvent>>;
// //#endregion

// //#region State
// export enum StateKind {
//   Atomic = 'Atomic',
//   Final = 'Final',
//   Compound = 'Compound',
// }
// type DefineState<
//   TStateName extends string,
//   TStateKind extends StateKind,
//   TData extends unknown,
//   TParentState extends AnyState,
//   TChildState extends AnyState = never,
// > = {
//   kind: TStateKind;
//   stateName: TStateName;
//   data: TData;
//   parentState?: TParentState;
//   childState?: TChildState;
// };
// export type DefineAtomicState<
//   TStateName extends string,
//   TData = never,
//   TParentState extends AnyState = never,
// > = DefineState<TStateName, StateKind.Atomic, TParentState, never, TData>;
// export type DefineCompoundState<
//   TStateName extends string,
//   TData = never,
//   TParentState extends AnyState = never,
// > = DefineState<TStateName, StateKind.Atomic, TParentState, never, TData>;
// export type DefineFinalState<TStateName extends string, TData = never> = {
//   kind: StateKind.Final;
//   stateName: TStateName;
//   data: TData;
// };
// export type AnyState = DefineState<string, StateKind, unknown, >;
// export type AnyAtomicState = DefineState<string, StateKind.Atomic, >;
// export type AnyFinalState = DefineState<string, StateKind.Final, unknown>;
// export type AnyCompoundState = DefineState<string, StateKind.Compound, unknown>;
// export type StateWithData<TState extends AnyState> = {
//   [TStateName in TState['stateName']]: [
//     Extract<TState, { stateName: TStateName }>['data']
//   ] extends [never]
//     ? never
//     : Extract<TState, { stateName: TStateName }>;
// }[TState['stateName']];
// export type StateWithoutData<TState extends AnyState> = Exclude<TState, StateWithData<TState>>;
// //#endregion

// //#region Chart
// export type DefineChart<
//   TState extends AnyState,
//   TEvent extends AnyEvent,
//   TParentState extends AnyCompoundState = DefineState<'@@root', StateKind.Compound, never>
// > = {
//   State: TState;
//   Event: TEvent;
//   ParentState: TParentState;
// };
// export type AnyChart = DefineChart<AnyState, AnyEvent, AnyCompoundState>;

// export type ChartEventWithoutData<TChart extends AnyChart> = TChart extends AnyChart
//   ? [TChart['Event']['data']] extends [never]
//     ? TChart['Event']
//     : never
//   : never;
// export type ChartEventWithData<TChart extends AnyChart> = Exclude<
//   TChart['Event'],
//   ChartEventWithoutData<TChart>
// >;

// export type ChartStateWithoutData<TChart extends AnyChart> = TChart extends AnyChart
//   ? [TChart['State']['data']] extends [never]
//     ? TChart['State']
//     : never
//   : never;
// export type ChartStateWithData<TChart extends AnyChart> = Exclude<
//   TChart['State'],
//   ChartStateWithoutData<TChart>
// >;
// //#endregion

// //#region Context
// export type ContextOnCondition<
//   TChart extends AnyChart,
//   TCurrentState extends TChart['State'],
//   TCurrentEvent extends TChart['Event'] = TChart['Event']
// > = {
//   // data: TChart['Data'];
//   event: TCurrentEvent;
//   state: TCurrentState;
// };

// export type ContextOnEnter<
//   TChart extends AnyChart,
//   TCurrentState extends TChart['State'] = TChart['State']
// > = {
//   // data: TChart['Data'];
//   event: TChart['Event'];
//   state: TCurrentState;

//   disposeOnExit(disposable: IDisposable): void;

//   send<TSendEvent extends EventWithoutData<TChart['Event']>>(event: TSendEvent['eventName']): void;
//   send<TSendEvent extends EventWithData<TChart['Event']>>(
//     event: TSendEvent['eventName'],
//     data: TSendEvent['data']
//   ): void;

//   transitionTo<TTargetState extends TChart['State']>(state: TTargetState['stateName']): void;
// };

// export type ContextOnEvent<
//   TChart extends AnyChart,
//   TCurrentState extends TChart['State'] = TChart['State'],
//   TCurrentEvent extends TChart['Event'] = TChart['Event']
// > = {
//   // data: TChart['Data'];
//   event: TCurrentEvent;
//   state: TCurrentState;

//   disposeOnExit(disposable: IDisposable): void;

//   send<TSendEvent extends EventWithoutData<TChart['Event']>>(event: TSendEvent['eventName']): void;
//   send<TSendEvent extends EventWithData<TChart['Event']>>(
//     event: TSendEvent['eventName'],
//     data: TSendEvent['data']
//   ): void;

//   transitionTo<TTargetState extends TChart['State']>(state: TTargetState['stateName']): void;
// };

// export type ContextOnExit<
//   TChart extends AnyChart,
//   TCurrentState extends TChart['State'] = TChart['State'],
//   TCurrentEvent extends TChart['Event'] = TChart['Event']
// > = {
//   // data: TChart['Data'];
//   event: TCurrentEvent;
//   state: TCurrentState;
// };
// //#endregion

// //#region Handlers
// export type HandleOnEnter<
//   TChart extends AnyChart,
//   TCurrentState extends TChart['State'],
//   TFiredEvent extends TChart['Event']
// > = (ctx: ContextOnEvent<TChart, TCurrentState, TFiredEvent>, event: TFiredEvent) => void;

// export type HandleOnEvent<
//   TChart extends AnyChart,
//   TCurrentState extends TChart['State'],
//   TFiredEvent extends TChart['Event']
// > = (ctx: ContextOnEvent<TChart, TCurrentState, TFiredEvent>, event: TFiredEvent) => void;

// export type HandleOnExit<
//   TChart extends AnyChart,
//   TCurrentState extends TChart['State'],
//   TFiredEvent extends TChart['Event']
// > = (ctx: ContextOnExit<TChart, TCurrentState, TFiredEvent>, event: TFiredEvent) => void;
// //#endregion
