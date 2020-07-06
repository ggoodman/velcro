export const foo = true;
// import { Graph } from '@velcro/bundler';
// import { buildMachine } from './fsm/builder';
// import { DefineAtomicState, DefineEvent } from './fsm/types';

// type BuilderState =
//   | DefineAtomicState<'initial'>
//   | DefineAtomicState<'dirty'>
//   | DefineAtomicState<'waiting'>
//   | DefineAtomicState<'building'>
//   | DefineAtomicState<'built', { graph: Graph }>
//   | DefineAtomicState<'error', { error: Error }>;

// type BuilderEvent =
//   | DefineEvent<'change'>
//   | DefineEvent<'timer_fired'>
//   | DefineEvent<'build_error', { error: Error }>
//   | DefineEvent<'build_complete', { graph: Graph }>;

// const machine = buildMachine<BuilderState, BuilderEvent>((state) =>
//   state
//     .defineState('initial', (state) => state.onEventTransition('change', 'dirty'))
//     .defineState('dirty', (state) => state.onEnterTransition('waiting'))
//     .defineState('waiting', (state) =>
//       state
//         .onEnterEmitAfterTimeout('timer_fired', 500)
//         .onEventTransition('change', 'dirty')
//         .onEventTransition('timer_fired', 'building')
//     )
//     .defineState('building', (state) =>
//       state
//         .onEventTransition('build_complete', 'built', (event) => ({ graph: event.data.graph }))
//         .onEventTransition('build_error', 'error', (event) => ({ error: event.data.error }))
//         .onEventTransition('change', 'dirty')
//     )
//     .defineState('built', (state) => state.onEventTransition('change', 'dirty'))
//     .defineState('error', (state) => state.onEventTransition('change', 'dirty'))
// );
