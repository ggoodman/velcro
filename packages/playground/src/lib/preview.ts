import { Emitter, Event } from 'ts-primitives';

export interface ErrorEvent {
  error: Error;
}

export interface RefreshEvent {}

export interface RuntimeErrorEvent {
  error: Error;
}

export interface Preview {
  onError: Event<ErrorEvent>;
  onRefresh: Event<RefreshEvent>;
  onRuntimeError: Event<RuntimeErrorEvent>;
}

class PreviewImpl implements Preview {
  private _onError = new Emitter<ErrorEvent>();
  private _onRefresh = new Emitter<RefreshEvent>();
  private _onRuntimeError = new Emitter<RuntimeErrorEvent>();

  constructor(private readonly hostEl: HTMLElement) {}

  get onError() {
    return this._onError.event;
  }
  get onRefresh() {
    return this._onRefresh.event;
  }
  get onRuntimeError() {
    return this._onRuntimeError.event;
  }
}

interface CreatePreviewOptions {}

export function createPreview(hostEl: HTMLElement, options?: CreatePreviewOptions) {
  return new PreviewImpl(hostEl);
}
