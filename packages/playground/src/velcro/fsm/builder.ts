export const foo = true;
// import {
//   AnyChart,
//   AnyCompoundState,
//   AnyEvent,
//   AnyState,
//   ChartEventWithData,
//   ChartEventWithoutData,
//   ChartStateWithData,
//   ChartStateWithoutData,
//   ContextOnCondition,
//   ContextOnEnter,
//   ContextOnEvent,
//   ContextOnExit,
//   DefineChart,
//   StateKind,
// } from './types';

// //#region Builder
// export interface FinalStateBuilder<TChart extends AnyChart, TThisState extends TChart['State']> {
//   onEnterEmitAfterTimeout<TThisEvent extends ChartEventWithoutData<TChart>>(
//     timeoutMs: number,
//     event: TThisEvent['eventName']
//   ): FinalStateBuilder<TChart, TThisState>;
//   onEnterEmitAfterTimeout<TThisEvent extends ChartEventWithData<TChart>>(
//     timeoutMs: number,
//     event: TThisEvent['eventName'],
//     dataFn: (ctx: ContextOnEnter<TChart, TThisState>) => TThisEvent['data']
//   ): FinalStateBuilder<TChart, TThisState>;
//   onEnterRun(handler: (ctx: ContextOnEnter<TChart, TThisState>) => void): void;
//   onEnterTransition<TNextState extends TChart['State']>(
//     stateName: TNextState['stateName']
//   ): FinalStateBuilder<TChart, TThisState>;

//   onEventRun<TFiredEvent extends TChart['Event']>(
//     event: TFiredEvent['eventName'],
//     handler: (ctx: ContextOnEvent<TChart, TThisState, TFiredEvent>) => void
//   ): FinalStateBuilder<TChart, TThisState>;
//   onEventTransition<
//     TFiredEvent extends TChart['Event'],
//     TTargetState extends ChartStateWithoutData<TChart>
//   >(
//     event: TFiredEvent['eventName'],
//     stateName: TTargetState['stateName']
//   ): FinalStateBuilder<TChart, TThisState>;

//   onEventTransition<
//     TFiredEvent extends TChart['Event'],
//     TTargetState extends ChartStateWithData<TChart>
//   >(
//     event: TFiredEvent['eventName'],
//     stateName: TTargetState['stateName'],
//     dataFn: (ctx: ContextOnEvent<TChart, TThisState, TFiredEvent>) => TTargetState['data']
//   ): FinalStateBuilder<TChart, TThisState>;
// }

// export interface CompoundStateBuilder<
//   TChart extends AnyChart,
//   TParentState extends AnyState = AnyCompoundState
// > extends FinalStateBuilder<TChart, TParentState> {
//   defineState<TThisState extends TChart['State']>(
//     stateName: TThisState['stateName'],
//     buildStateFn: (stateBuilder: FinalStateBuilder<TChart, TThisState>) => void
//   ): CompoundStateBuilder<TChart, TParentState>;
// }

// interface FinalStateConfig<TChart extends AnyChart, TThisState extends TChart['State']> {
//   onEnter: {
//     condition?: (ctx: ContextOnCondition<TChart, TThisState>) => boolean;
//     handler: (ctx: ContextOnEnter<TChart, TThisState>) => void;
//   }[];
//   onEvent: {
//     [TEventName in TChart['Event']['eventName']]?: {
//       condition?: (ctx: ContextOnCondition<TChart, TThisState>) => boolean;
//       handler: (ctx: ContextOnEvent<TChart, TThisState>) => void;
//     }[];
//   };
//   onExit: {
//     condition?: (ctx: ContextOnCondition<TChart, TThisState>) => boolean;
//     handler: (ctx: ContextOnExit<TChart, TThisState, TChart['Event']>) => void;
//   }[];
// }

// interface CompoundStateConfig<
//   TChart extends AnyChart,
//   TParentState extends AnyState = TChart['State']
// > extends FinalStateConfig<TChart, TParentState> {}

// export function buildMachine<
//   TState extends AnyState,
//   TEvent extends AnyEvent,
//   TContext extends unknown = never,
//   TParentState extends AnyCompoundState = DefineState<string, StateKind.Compound, TContext>
// >(
//   builderFn: (
//     state: CompoundStateBuilder<DefineChart<TState, TEvent, TParentState>, TParentState>
//   ) => void
// ) {
//   const builder = new CompoundStateBuilderImpl<
//     DefineChart<TState, TEvent, TParentState>,
//     TParentState
//   >();

//   builderFn(builder);
// }

// class FinalStateBuilderImpl<TChart extends AnyChart, TThisState extends AnyState = TChart['State']>
//   implements FinalStateBuilder<TChart, TThisState> {
//   readonly stateConfig: FinalStateConfig<TChart, TThisState> = {
//     onEnter: [],
//     onEvent: {},
//     onExit: [],
//   };

//   onEnterEmitAfterTimeout<TThisEvent extends TChart['Event']>(
//     timeoutMs: number,
//     event: TThisEvent['eventName'],
//     dataFn?: (ctx: ContextOnEnter<TChart, TThisState>) => TThisEvent['data']
//   ): FinalStateBuilder<TChart, TThisState> {
//     this.appendEnterHandler((ctx) => {
//       const timerHandle = setTimeout(() => {
//         const eventData = typeof dataFn === 'function' ? dataFn(ctx) : undefined;

//         ctx.send(event, eventData);
//       }, timeoutMs);

//       ctx.disposeOnExit({
//         dispose: () => clearTimeout(timerHandle),
//       });
//     });

//     return this;
//   }

//   onEnterRun(handler: (ctx: ContextOnEnter<TChart, TThisState>) => void) {
//     this.appendEnterHandler(handler);

//     return this;
//   }

//   onEnterTransition<TTargetState extends TChart['State']>(
//     stateName: TTargetState['stateName']
//   ): FinalStateBuilder<TChart, TThisState> {
//     this.appendEnterHandler((ctx) => ctx.transitionTo(stateName));

//     return this;
//   }

//   onEventRun<TFiredEvent extends TChart['Event']>(
//     event: TFiredEvent['eventName'],
//     handler: (ctx: ContextOnEvent<TChart, TThisState, TFiredEvent>) => void
//   ): FinalStateBuilder<TChart, TThisState> {
//     this.appendEventHandler(event, handler);

//     return this;
//   }

//   onEventTransition<TFiredEvent extends TChart['Event'], TTargetState extends TChart['State']>(
//     event: TFiredEvent['eventName'],
//     stateName: TTargetState['stateName']
//   ): FinalStateBuilder<TChart, TThisState> {
//     this.appendEventHandler(event, (ctx) => ctx.transitionTo(stateName));

//     return this;
//   }

//   onExitRun(handler: (ctx: ContextOnExit<TChart, TThisState>) => void) {
//     this.appendExitHandler(handler);

//     return this;
//   }

//   private appendEnterHandler<TCurrentEvent extends TChart['Event']>(
//     handler: (ctx: ContextOnEnter<TChart, TThisState>) => void,
//     condition?: (ctx: ContextOnCondition<TChart, TThisState>) => boolean
//   ) {
//     this.stateConfig.onEnter.push({ condition, handler });
//   }

//   private appendEventHandler<TCurrentEvent extends TChart['Event']>(
//     event: TCurrentEvent['eventName'],
//     handler: (ctx: ContextOnEvent<TChart, TThisState, TCurrentEvent>) => void,
//     condition?: (ctx: ContextOnCondition<TChart, TThisState, TCurrentEvent>) => boolean
//   ) {
//     let eventConfig = this.stateConfig.onEvent[event];

//     if (!eventConfig) {
//       eventConfig = [];
//       this.stateConfig.onEvent[event] = eventConfig;
//     }

//     eventConfig.push({ condition, handler } as {
//       condition?: (ctx: ContextOnCondition<TChart, TThisState>) => boolean;
//       handler: (ctx: ContextOnEvent<TChart, TThisState>) => void;
//     });
//   }

//   private appendExitHandler<TCurrentEvent extends TChart['Event']>(
//     handler: (ctx: ContextOnExit<TChart, TThisState>) => void,
//     condition?: (ctx: ContextOnCondition<TChart, TThisState>) => boolean
//   ) {
//     this.stateConfig.onEnter.push({ condition, handler });
//   }
// }

// class CompoundStateBuilderImpl<TChart extends AnyChart, TParentState extends AnyCompoundState>
//   extends FinalStateBuilderImpl<TChart, TParentState>
//   implements CompoundStateBuilder<TChart, TParentState> {
//   readonly stateBuilders: {
//     [TStateName in TChart['State']['stateName']]?: FinalStateBuilderImpl<
//       TChart,
//       Extract<TChart['State'], { stateName: TStateName }>
//     >;
//   } = {};

//   defineState<TThisState extends TChart['State']>(
//     stateName: TThisState['stateName'],
//     buildStateFn: (stateBuilder: FinalStateBuilder<TChart, TThisState>) => void
//   ): CompoundStateBuilder<TChart, TParentState> {
//     let stateBuilder = this.stateBuilders[stateName] as
//       | FinalStateBuilderImpl<TChart, TThisState>
//       | undefined;

//     if (!stateBuilder) {
//       stateBuilder = new FinalStateBuilderImpl<TChart, TThisState>();
//       (this.stateBuilders as any)[stateName] = stateBuilder;
//     }

//     buildStateFn(stateBuilder as FinalStateBuilder<TChart, TThisState>);

//     return this;
//   }

//   toChart(): {
//     states: {
//       [TStateName in TChart['State']['stateName']]?: FinalStateBuilderImpl<
//         TChart,
//         Extract<TChart['State'], { stateName: TStateName }>
//       >;
//     };
//   } {
//     const chart: {
//       states: {
//         [TStateName in TChart['State']['stateName']]?: FinalStateBuilderImpl<
//           TChart,
//           Extract<TChart['State'], { stateName: TStateName }>
//         >;
//       };
//     } = { ...this.stateConfig, states: {} };

//     return {
//       ...this.stateConfig,
//       states: Object.keys(this.stateBuilders).reduce(
//         (states, stateName: TChart['State']['stateName']) => {
//           states[stateName] = this.stateBuilders[stateName]!.stateConfig;
//           return states;
//         },
//         {} as any
//       ),
//     };
//   }
// }
