/** Small .NET-style MVVM primitives. No framework or DOM dependency is required. */
import type { IDisposable } from "./model.js";
export type { IDisposable } from "./model.js";
export class Subscription implements IDisposable {
  private cleanup: (() => void) | undefined;
  constructor(cleanup: () => void) {
    this.cleanup = cleanup;
  }
  Dispose(): void {
    const cleanup = this.cleanup;
    this.cleanup = undefined;
    cleanup?.();
  }
}

/** Composite owns its children and immediately disposes additions after disposal. */
export class CompositeDisposable implements IDisposable {
  private items = new Set<IDisposable>();
  private disposed = false;
  Add<T extends IDisposable>(item: T): T {
    if (this.disposed) item.Dispose();
    else this.items.add(item);
    return item;
  }
  Dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const errors: unknown[] = [];
    for (const item of this.items) {
      try {
        item.Dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    this.items.clear();
    if (errors.length)
      throw new AggregateError(
        errors,
        "One or more subscriptions failed to dispose",
      );
  }
}

export class ObservableEvent<T> {
  private listeners = new Set<(args: T) => void>();
  Subscribe(listener: (args: T) => void): IDisposable {
    this.listeners.add(listener);
    return new Subscription(() => this.listeners.delete(listener));
  }
  Emit(args: T): void {
    for (const listener of [...this.listeners]) listener(args);
  }
  Clear(): void {
    this.listeners.clear();
  }
}

export interface PropertyChangedEventArgs {
  Sender: ObservableObject;
  PropertyName: string;
  OldValue: unknown;
  NewValue: unknown;
}
const unsafeNames = new Set(["__proto__", "prototype", "constructor"]);
function assertPropertyName(name: string): void {
  if (!name || unsafeNames.has(name))
    throw new TypeError(`Invalid property name: ${name}`);
}

export class ObservableObject implements IDisposable {
  readonly PropertyChanged = new ObservableEvent<PropertyChangedEventArgs>();
  private readonly values = new Map<string, unknown>();
  private disposed = false;
  constructor(initialValues: Record<string, unknown> = {}) {
    for (const [name, value] of Object.entries(initialValues))
      this.DefineProperty(name, value);
  }
  GetProperty<T>(name: string, defaultValue?: T): T {
    return (this.values.has(name) ? this.values.get(name) : defaultValue) as T;
  }
  /** Also useful inside conventional get/set accessors on a subclass. */
  SetProperty<T>(name: string, value: T): boolean {
    assertPropertyName(name);
    if (this.disposed) throw new Error("ObservableObject is disposed");
    const previous = this.values.get(name);
    if (this.values.has(name) && Object.is(previous, value)) return false;
    this.values.set(name, value);
    this.OnPropertyChanged(name, previous, value);
    return true;
  }
  DefineProperty<T>(name: string, value: T): this {
    assertPropertyName(name);
    if (name in this) throw new TypeError(`Property already exists: ${name}`);
    Object.defineProperty(this, name, {
      enumerable: true,
      configurable: false,
      get: () => this.GetProperty<T>(name),
      set: (next: T) => this.SetProperty(name, next),
    });
    this.SetProperty(name, value);
    return this;
  }
  protected OnPropertyChanged(
    name: string,
    oldValue?: unknown,
    newValue?: unknown,
  ): void {
    this.PropertyChanged.Emit({
      Sender: this,
      PropertyName: name,
      OldValue: oldValue,
      NewValue: newValue,
    });
  }
  Dispose(): void {
    this.disposed = true;
    this.PropertyChanged.Clear();
  }
}

export interface ICommand<T = unknown> {
  readonly CanExecuteChanged: ObservableEvent<void>;
  CanExecute(parameter?: T): boolean;
  Execute(parameter?: T): unknown;
}
export class RelayCommand<T = unknown> implements ICommand<T>, IDisposable {
  readonly CanExecuteChanged = new ObservableEvent<void>();
  private disposed = false;
  constructor(
    private readonly execute: (parameter?: T) => void,
    private readonly canExecute: (parameter?: T) => boolean = () => true,
  ) {}
  CanExecute(parameter?: T): boolean {
    return !this.disposed && this.canExecute(parameter);
  }
  Execute(parameter?: T): boolean {
    if (!this.CanExecute(parameter)) return false;
    this.execute(parameter);
    return true;
  }
  NotifyCanExecuteChanged(): void {
    this.CanExecuteChanged.Emit();
  }
  RaiseCanExecuteChanged(): void {
    this.NotifyCanExecuteChanged();
  }
  Dispose(): void {
    this.disposed = true;
    this.NotifyCanExecuteChanged();
    this.CanExecuteChanged.Clear();
  }
}

/** Execute returns a rejecting promise on failure; callers retain responsibility for handling errors. */
export class AsyncRelayCommand<T = unknown>
  extends ObservableObject
  implements ICommand<T>
{
  readonly CanExecuteChanged = new ObservableEvent<void>();
  ExecutionTask: Promise<void> | undefined;
  private controller: AbortController | undefined;
  private commandDisposed = false;
  constructor(
    private readonly execute: (
      parameter: T | undefined,
      signal: AbortSignal,
    ) => Promise<void>,
    private readonly canExecute: (parameter?: T) => boolean = () => true,
  ) {
    super();
  }
  get IsRunning(): boolean {
    return this.GetProperty("IsRunning", false);
  }
  get Error(): unknown {
    return this.GetProperty("Error");
  }
  CanExecute(parameter?: T): boolean {
    return (
      !this.commandDisposed && !this.IsRunning && this.canExecute(parameter)
    );
  }
  Execute(parameter?: T): Promise<void> {
    if (!this.CanExecute(parameter)) return Promise.resolve();
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.SetProperty("IsRunning", true);
    this.SetProperty("Error", undefined);
    this.NotifyCanExecuteChanged();
    this.ExecutionTask = Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return this.execute(parameter, signal);
      })
      .catch((error) => {
        if (!this.commandDisposed) this.SetProperty("Error", error);
        throw error;
      })
      .finally(() => {
        this.controller = undefined;
        if (!this.commandDisposed) {
          this.SetProperty("IsRunning", false);
          this.NotifyCanExecuteChanged();
        }
      });
    return this.ExecutionTask;
  }
  Cancel(): void {
    this.controller?.abort();
  }
  NotifyCanExecuteChanged(): void {
    this.CanExecuteChanged.Emit();
  }
  override Dispose(): void {
    if (this.commandDisposed) return;
    this.commandDisposed = true;
    this.Cancel();
    this.SetProperty("IsRunning", false);
    this.CanExecuteChanged.Emit();
    this.CanExecuteChanged.Clear();
    super.Dispose();
  }
}

export const BindingMode = {
  OneWay: "OneWay",
  TwoWay: "TwoWay",
  OneTime: "OneTime",
  OneWayToSource: "OneWayToSource",
} as const;
export type BindingMode = (typeof BindingMode)[keyof typeof BindingMode];
export interface IValueConverter {
  Convert(value: unknown, parameter?: unknown): unknown;
  ConvertBack?(value: unknown, parameter?: unknown): unknown;
}
export interface BindingOptions {
  Source: object;
  Path: string;
  Mode?: BindingMode;
  Converter?: IValueConverter;
  ConverterParameter?: unknown;
  /** A DOM event used to push edited target values back to Source. */
  UpdateSourceEvent?: string;
}
interface ObservableSource {
  PropertyChanged?: {
    Subscribe(listener: (args: { PropertyName: string }) => void): IDisposable;
  };
}
function readProperty(value: unknown, name: string): unknown {
  if (value == null) return undefined;
  return (value as Record<string, unknown>)[name];
}

export class Binding {
  readonly Options: Readonly<BindingOptions>;
  constructor(options: BindingOptions) {
    if (!options.Source || typeof options.Source !== "object")
      throw new TypeError("Binding.Source must be an object");
    if (
      !options.Path ||
      options.Path.split(".").some((part) => !part || unsafeNames.has(part))
    )
      throw new TypeError("Binding.Path must contain safe property names");
    if (options.Mode && !Object.values(BindingMode).includes(options.Mode))
      throw new TypeError("Unknown binding mode");
    this.Options = { ...options };
  }
  Attach(target: object, targetProperty: string): BindingExpression {
    return new BindingExpression(this.Options, target, targetProperty);
  }
  static SetBinding(
    target: object,
    targetProperty: string,
    binding: Binding | BindingOptions,
  ): BindingExpression {
    return (binding instanceof Binding ? binding : new Binding(binding)).Attach(
      target,
      targetProperty,
    );
  }
}

export class BindingExpression implements IDisposable {
  private readonly path: string[];
  private sourceSubscriptions: IDisposable[] = [];
  private targetSubscription: IDisposable | undefined;
  private updating = false;
  private disposed = false;
  private readonly mode: BindingMode;
  constructor(
    private readonly options: Readonly<BindingOptions>,
    private readonly target: object,
    private readonly targetProperty: string,
  ) {
    assertPropertyName(targetProperty);
    this.path = options.Path.split(".");
    this.mode = options.Mode ?? BindingMode.OneWay;
    try {
      if (this.mode !== BindingMode.OneTime) this.subscribeSource();
      if (
        this.mode === BindingMode.TwoWay ||
        this.mode === BindingMode.OneWayToSource
      )
        this.subscribeTarget();
      if (this.mode === BindingMode.OneWayToSource) this.UpdateSource();
      else this.UpdateTarget();
    } catch (error) {
      this.Dispose();
      throw error;
    }
  }
  private subscribeSource(): void {
    for (const item of this.sourceSubscriptions) item.Dispose();
    this.sourceSubscriptions = [];
    let current: unknown = this.options.Source;
    for (const segment of this.path) {
      const observable = current as ObservableSource | undefined;
      if (observable?.PropertyChanged?.Subscribe) {
        this.sourceSubscriptions.push(
          observable.PropertyChanged.Subscribe((args) => {
            if (
              this.disposed ||
              (args.PropertyName && args.PropertyName !== segment)
            )
              return;
            this.subscribeSource();
            if (!this.updating && this.mode !== BindingMode.OneWayToSource)
              this.UpdateTarget();
          }),
        );
      }
      current = readProperty(current, segment);
    }
  }
  private subscribeTarget(): void {
    const observable = this.target as ObservableSource;
    if (observable.PropertyChanged?.Subscribe) {
      this.targetSubscription = observable.PropertyChanged.Subscribe((args) => {
        if (!args.PropertyName || args.PropertyName === this.targetProperty)
          this.UpdateSource();
      });
    } else if (
      "addEventListener" in this.target &&
      "removeEventListener" in this.target
    ) {
      const target = this.target as EventTarget;
      const event =
        this.options.UpdateSourceEvent ??
        (this.targetProperty === "Document" ? "documentchange" : "change");
      const listener = () => this.UpdateSource();
      target.addEventListener(event, listener);
      this.targetSubscription = new Subscription(() =>
        target.removeEventListener(event, listener),
      );
    } else if (!this.options.UpdateSourceEvent) {
      // Plain objects support explicit UpdateSource() for frameworks with their own change tracking.
    }
  }
  UpdateTarget(): void {
    if (this.disposed || this.updating) return;
    this.updating = true;
    try {
      let value: unknown = this.options.Source;
      for (const segment of this.path) value = readProperty(value, segment);
      if (this.options.Converter)
        value = this.options.Converter.Convert(
          value,
          this.options.ConverterParameter,
        );
      (this.target as Record<string, unknown>)[this.targetProperty] = value;
    } finally {
      this.updating = false;
    }
  }
  UpdateSource(): void {
    if (this.disposed || this.updating) return;
    if (
      this.mode !== BindingMode.TwoWay &&
      this.mode !== BindingMode.OneWayToSource
    )
      return;
    this.updating = true;
    try {
      let owner: unknown = this.options.Source;
      for (const segment of this.path.slice(0, -1))
        owner = readProperty(owner, segment);
      if (owner == null || typeof owner !== "object")
        throw new TypeError(
          `Cannot write binding path ${this.options.Path}: parent is missing`,
        );
      let value = readProperty(this.target, this.targetProperty);
      if (this.options.Converter) {
        if (!this.options.Converter.ConvertBack)
          throw new TypeError("A two-way converter must implement ConvertBack");
        value = this.options.Converter.ConvertBack(
          value,
          this.options.ConverterParameter,
        );
      }
      (owner as Record<string, unknown>)[this.path[this.path.length - 1]!] =
        value;
    } finally {
      this.updating = false;
    }
  }
  Dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const item of this.sourceSubscriptions) item.Dispose();
    this.sourceSubscriptions = [];
    this.targetSubscription?.Dispose();
    this.targetSubscription = undefined;
  }
}

/** Connects a button-like DOM target to ICommand and owns its event subscriptions. */
export function BindCommand<T>(
  target: EventTarget & { disabled?: boolean },
  command: ICommand<T>,
  parameter?: T | (() => T),
  onError?: (error: unknown) => void,
): IDisposable {
  const getParameter = () =>
    typeof parameter === "function" ? (parameter as () => T)() : parameter;
  const refresh = () => {
    target.disabled = !command.CanExecute(getParameter());
  };
  const handleError = (error: unknown) => {
    if (onError) onError(error);
    else if (typeof CustomEvent !== "undefined")
      target.dispatchEvent(
        new CustomEvent("commanderror", {
          detail: { error },
          bubbles: true,
          composed: true,
        }),
      );
    else
      queueMicrotask(() => {
        throw error;
      });
  };
  const listener = () => {
    try {
      const value = getParameter();
      if (!command.CanExecute(value)) return;
      const result = command.Execute(value);
      if (result && typeof (result as PromiseLike<unknown>).then === "function")
        void Promise.resolve(result).catch(handleError);
    } catch (error) {
      handleError(error);
    }
  };
  target.addEventListener("click", listener);
  const subscription = command.CanExecuteChanged.Subscribe(refresh);
  refresh();
  return new Subscription(() => {
    target.removeEventListener("click", listener);
    subscription.Dispose();
  });
}
