// deno-lint-ignore-file no-explicit-any
type TraceOption = boolean | ((info: Record<string, unknown>) => void);
type FailureMode = "log" | "throw";
type MaybePromise<T> = T | Promise<T>;

let globalFailureMode: FailureMode = "log";

function setFailureMode(mode: FailureMode): FailureMode {
  const previous = globalFailureMode;
  globalFailureMode = mode;
  return previous;
}

function getFailureMode(): FailureMode {
  return globalFailureMode;
}

function handleFailure(mode: FailureMode, message: string): void {
  if (mode === "throw") {
    throw new Error(message);
  }
  console.error(`[always] ${message}`);
}

function getClassName(self: unknown): string {
  try {
    const ctor = (self as { constructor?: { name?: string } })?.constructor;
    return ctor?.name ?? "<anonymous>";
  } catch {
    return "<anonymous>";
  }
}

function formatValue(value: unknown): string {
  const cache = new WeakSet<object>();
  const replacer = (_key: string, val: unknown) => {
    if (typeof val === "bigint") return `${val}n`;
    if (typeof val === "function") {
      const fn = val as { name?: string };
      return `[Function ${fn.name || "anonymous"}]`;
    }
    if (typeof val === "symbol") return String(val);
    if (typeof val === "object" && val !== null) {
      if (cache.has(val as object)) return "[Circular]";
      cache.add(val as object);
    }
    return val as any;
  };
  try {
    if (typeof value === "string") return JSON.stringify(value);
    if (value === undefined) return "undefined";
    if (value === null) return "null";
    return JSON.stringify(value as unknown, replacer);
  } catch {
    try {
      return String(value);
    } catch {
      return "<unprintable>";
    }
  }
}

function formatArgs(args: unknown[]): string {
  return args.map(formatValue).join(", ");
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null &&
    "then" in value && typeof (value as { then?: unknown }).then === "function";
}

type ResolvedSpec = {
  before?: (...args: unknown[]) => MaybePromise<boolean>;
  after?: (result: unknown, ...args: unknown[]) => MaybePromise<boolean>;
  constant?: (self: unknown) => MaybePromise<boolean>;
  trace?: TraceOption;
  failureMode?: FailureMode;
};

function resolveSpec(input: unknown): ResolvedSpec {
  const spec = typeof input === "object" && input !== null
    ? input as Record<string, unknown>
    : {};
  const before = typeof spec.before === "function"
    ? spec.before as ResolvedSpec["before"]
    : typeof spec.requires === "function"
    ? spec.requires as ResolvedSpec["before"]
    : undefined;
  const after = typeof spec.after === "function"
    ? spec.after as ResolvedSpec["after"]
    : typeof spec.ensures === "function"
    ? spec.ensures as ResolvedSpec["after"]
    : undefined;
  const constantFromObject = spec.constant ?? spec.invariant;
  const constant = typeof input === "function"
    ? input as ResolvedSpec["constant"]
    : typeof constantFromObject === "function"
    ? constantFromObject as ResolvedSpec["constant"]
    : undefined;
  const trace =
    typeof spec.trace === "boolean" || typeof spec.trace === "function"
      ? spec.trace as TraceOption
      : undefined;

  const failureCandidate = spec.failureMode;
  const failureMode = failureCandidate === "throw" || failureCandidate === "log"
    ? failureCandidate as FailureMode
    : undefined;

  return { before, after, constant, trace, failureMode };
}

function emitTrace(
  trace: TraceOption | undefined,
  info: Record<string, unknown>,
) {
  const effective = trace === undefined ? true : trace;
  if (!effective) return;
  try {
    if (typeof effective === "function") {
      effective(info);
    } else {
      console.trace("[always]", info);
    }
  } catch {
    // ignore trace failures
  }
}

type MethodFailureKind =
  | "constant-before"
  | "before"
  | "after"
  | "constant-after";

type SetterFailureKind =
  | "constant-before"
  | "setter-before"
  | "setter-after"
  | "constant-after";

type AsyncMethodState<Value extends (...args: any[]) => any> = {
  constantBefore?: MaybePromise<boolean>;
  before?: MaybePromise<boolean>;
  result?: ReturnType<Value> | PromiseLike<Awaited<ReturnType<Value>>>;
  after?: MaybePromise<boolean>;
  constantAfter?: MaybePromise<boolean>;
};

type AsyncSetterState<Property, Result> = {
  constantBefore?: MaybePromise<boolean>;
  before?: MaybePromise<boolean>;
  result?: Result | PromiseLike<Awaited<Result>>;
  after?: MaybePromise<boolean>;
  constantAfter?: MaybePromise<boolean>;
  value: Property;
};

function reportMethodFailure(
  kind: MethodFailureKind,
  trace: TraceOption | undefined,
  failureMode: FailureMode,
  label: string,
  thisArg: unknown,
  args: unknown[],
  result?: unknown,
): void {
  const cls = getClassName(thisArg);
  const info: Record<string, unknown> = {
    kind,
    class: cls,
    name: label,
    args,
  };
  if (result !== undefined) info.result = result;
  emitTrace(trace, info);

  const formattedArgs = formatArgs(args);
  const call = `${cls}.${label}(${formattedArgs})`;
  let message: string;
  if (kind === "after") {
    message = `After failed: ${call} -> ${formatValue(result)}`;
  } else if (kind === "constant-after") {
    message = `Constant failed after: ${call} -> ${formatValue(result)}`;
  } else if (kind === "constant-before") {
    message = `Constant failed before: ${call}`;
  } else {
    message = `Before failed: ${call}`;
  }
  handleFailure(failureMode, message);
}

function reportSetterFailure<Property, Result>(
  kind: SetterFailureKind,
  trace: TraceOption | undefined,
  failureMode: FailureMode,
  label: string,
  thisArg: unknown,
  value: Property,
  result?: Result,
): void {
  const cls = getClassName(thisArg);
  const info: Record<string, unknown> = {
    kind,
    class: cls,
    name: label,
    value,
  };
  if (result !== undefined) info.result = result;
  emitTrace(trace, info);

  const formattedValue = formatValue(value);
  const call = `${cls}.set ${label}(${formattedValue})`;
  let message: string;
  if (kind === "setter-after") {
    message = `After failed: ${call} -> ${formatValue(result)}`;
  } else if (kind === "constant-after") {
    message = `Constant failed after: ${call} -> ${formatValue(result)}`;
  } else if (kind === "constant-before") {
    message = `Constant failed before: ${call}`;
  } else {
    message = `Before failed: ${call}`;
  }
  handleFailure(failureMode, message);
}

async function runAsyncMethod<
  This,
  Value extends (this: This, ...args: any[]) => any,
>(
  original: Value,
  thisArg: This,
  label: string,
  args: Parameters<Value>,
  displayArgs: unknown[],
  spec: ResolvedSpec,
  failureMode: FailureMode,
  initial: AsyncMethodState<Value>,
): Promise<Awaited<ReturnType<Value>>> {
  const { before, after, constant, trace } = spec;

  if (constant) {
    const ok = await (initial.constantBefore ?? constant(thisArg));
    if (!ok) {
      reportMethodFailure(
        "constant-before",
        trace,
        failureMode,
        label,
        thisArg,
        displayArgs,
      );
      return undefined as Awaited<ReturnType<Value>>;
    }
  }

  if (before) {
    const ok = await (initial.before ?? before(...displayArgs));
    if (!ok) {
      reportMethodFailure(
        "before",
        trace,
        failureMode,
        label,
        thisArg,
        displayArgs,
      );
      return undefined as Awaited<ReturnType<Value>>;
    }
  }

  const rawResult = initial.result ?? original.apply(thisArg, args);
  const resolvedResult = await rawResult as Awaited<ReturnType<Value>>;

  if (after) {
    const ok =
      await (initial.after ?? after(resolvedResult as unknown, ...displayArgs));
    if (!ok) {
      reportMethodFailure(
        "after",
        trace,
        failureMode,
        label,
        thisArg,
        displayArgs,
        resolvedResult,
      );
      return resolvedResult;
    }
  }

  if (constant) {
    const ok = await (initial.constantAfter ?? constant(thisArg));
    if (!ok) {
      reportMethodFailure(
        "constant-after",
        trace,
        failureMode,
        label,
        thisArg,
        displayArgs,
        resolvedResult,
      );
      return resolvedResult;
    }
  }

  return resolvedResult;
}

async function runAsyncSetter<This, Property, Result>(
  original: (this: This, value: Property) => Result,
  thisArg: This,
  label: string,
  spec: ResolvedSpec,
  failureMode: FailureMode,
  state: AsyncSetterState<Property, Result>,
): Promise<Awaited<Result>> {
  const { before, after, constant, trace } = spec;

  if (constant) {
    const ok = await (state.constantBefore ?? constant(thisArg));
    if (!ok) {
      reportSetterFailure(
        "constant-before",
        trace,
        failureMode,
        label,
        thisArg,
        state.value,
      );
      return undefined as Awaited<Result>;
    }
  }

  if (before) {
    const ok = await (state.before ?? before(state.value));
    if (!ok) {
      reportSetterFailure(
        "setter-before",
        trace,
        failureMode,
        label,
        thisArg,
        state.value,
      );
      return undefined as Awaited<Result>;
    }
  }

  const rawResult = state.result ?? original.call(thisArg, state.value);
  const resolvedResult = await rawResult as Awaited<Result>;

  if (after) {
    const ok =
      await (state.after ?? after(resolvedResult as unknown, state.value));
    if (!ok) {
      reportSetterFailure(
        "setter-after",
        trace,
        failureMode,
        label,
        thisArg,
        state.value,
        resolvedResult,
      );
      return resolvedResult;
    }
  }

  if (constant) {
    const ok = await (state.constantAfter ?? constant(thisArg));
    if (!ok) {
      reportSetterFailure(
        "constant-after",
        trace,
        failureMode,
        label,
        thisArg,
        state.value,
        resolvedResult,
      );
      return resolvedResult;
    }
  }

  return resolvedResult;
}

function wrapMethod<This, Value extends (this: This, ...args: any[]) => any>(
  original: Value,
  label: string,
  spec: ResolvedSpec,
): Value {
  const { before, constant } = spec;
  const wrapped = function (
    this: This,
    ...args: Parameters<Value>
  ): ReturnType<Value> {
    const displayArgs = args as unknown[];
    const failureMode = spec.failureMode ?? getFailureMode();
    const trace = spec.trace;

    const constantBefore = constant ? constant(this) : undefined;
    if (constant && isPromiseLike(constantBefore)) {
      return runAsyncMethod(
        original,
        this,
        label,
        args,
        displayArgs,
        spec,
        failureMode,
        { constantBefore },
      ) as unknown as ReturnType<Value>;
    }
    if (constant && constantBefore === false) {
      reportMethodFailure(
        "constant-before",
        trace,
        failureMode,
        label,
        this,
        displayArgs,
      );
      return undefined as ReturnType<Value>;
    }

    const beforeResult = before ? before(...displayArgs) : undefined;
    if (before && isPromiseLike(beforeResult)) {
      return runAsyncMethod(
        original,
        this,
        label,
        args,
        displayArgs,
        spec,
        failureMode,
        {
          constantBefore: constant ? true : undefined,
          before: beforeResult,
        },
      ) as unknown as ReturnType<Value>;
    }
    if (before && beforeResult === false) {
      reportMethodFailure(
        "before",
        trace,
        failureMode,
        label,
        this,
        displayArgs,
      );
      return undefined as ReturnType<Value>;
    }

    const result = original.apply(this, args);
    if (isPromiseLike(result)) {
      return runAsyncMethod(
        original,
        this,
        label,
        args,
        displayArgs,
        spec,
        failureMode,
        {
          constantBefore: constant ? true : undefined,
          before: before ? true : undefined,
          result: result as PromiseLike<Awaited<ReturnType<Value>>>,
        },
      ) as unknown as ReturnType<Value>;
    }

    const after = spec.after;
    const afterResult = after
      ? after(result as unknown, ...displayArgs)
      : undefined;
    if (after && isPromiseLike(afterResult)) {
      return runAsyncMethod(
        original,
        this,
        label,
        args,
        displayArgs,
        spec,
        failureMode,
        {
          constantBefore: constant ? true : undefined,
          before: before ? true : undefined,
          result,
          after: afterResult,
        },
      ) as unknown as ReturnType<Value>;
    }
    if (after && afterResult === false) {
      reportMethodFailure(
        "after",
        trace,
        failureMode,
        label,
        this,
        displayArgs,
        result,
      );
      return result;
    }

    const constantAfter = constant ? constant(this) : undefined;
    if (constant && isPromiseLike(constantAfter)) {
      return runAsyncMethod(
        original,
        this,
        label,
        args,
        displayArgs,
        spec,
        failureMode,
        {
          constantBefore: true,
          before: before ? true : undefined,
          result,
          after: after ? true : undefined,
          constantAfter,
        },
      ) as unknown as ReturnType<Value>;
    }
    if (constant && constantAfter === false) {
      reportMethodFailure(
        "constant-after",
        trace,
        failureMode,
        label,
        this,
        displayArgs,
        result,
      );
      return result;
    }

    return result;
  } as (...args: Parameters<Value>) => ReturnType<Value>;

  return wrapped as Value;
}

function wrapSetter<This, Property, Result>(
  original: (this: This, value: Property) => Result,
  label: string,
  spec: ResolvedSpec,
): (this: This, value: Property) => Result {
  const { before, constant } = spec;
  const wrapped = function (this: This, value: Property): Result {
    const failureMode = spec.failureMode ?? getFailureMode();
    const trace = spec.trace;
    const displayValue = value;

    const constantBefore = constant ? constant(this) : undefined;
    if (constant && isPromiseLike(constantBefore)) {
      return runAsyncSetter(
        original,
        this,
        label,
        spec,
        failureMode,
        {
          constantBefore,
          value,
        },
      ) as unknown as Result;
    }
    if (constant && constantBefore === false) {
      reportSetterFailure(
        "constant-before",
        trace,
        failureMode,
        label,
        this,
        displayValue,
      );
      return undefined as Result;
    }

    const beforeResult = before ? before(displayValue) : undefined;
    if (before && isPromiseLike(beforeResult)) {
      return runAsyncSetter(
        original,
        this,
        label,
        spec,
        failureMode,
        {
          constantBefore: constant ? true : undefined,
          before: beforeResult,
          value,
        },
      ) as unknown as Result;
    }
    if (before && beforeResult === false) {
      reportSetterFailure(
        "setter-before",
        trace,
        failureMode,
        label,
        this,
        displayValue,
      );
      return undefined as Result;
    }

    const result = original.call(this, value);
    if (isPromiseLike(result)) {
      return runAsyncSetter(
        original,
        this,
        label,
        spec,
        failureMode,
        {
          constantBefore: constant ? true : undefined,
          before: before ? true : undefined,
          result: result as PromiseLike<Awaited<Result>>,
          value,
        },
      ) as unknown as Result;
    }

    const after = spec.after;
    const afterResult = after
      ? after(result as unknown, displayValue)
      : undefined;
    if (after && isPromiseLike(afterResult)) {
      return runAsyncSetter(
        original,
        this,
        label,
        spec,
        failureMode,
        {
          constantBefore: constant ? true : undefined,
          before: before ? true : undefined,
          result,
          after: afterResult,
          value,
        },
      ) as unknown as Result;
    }
    if (after && afterResult === false) {
      reportSetterFailure(
        "setter-after",
        trace,
        failureMode,
        label,
        this,
        displayValue,
        result,
      );
      return result;
    }

    const constantAfter = constant ? constant(this) : undefined;
    if (constant && isPromiseLike(constantAfter)) {
      return runAsyncSetter(
        original,
        this,
        label,
        spec,
        failureMode,
        {
          constantBefore: true,
          before: before ? true : undefined,
          result,
          after: after ? true : undefined,
          constantAfter,
          value,
        },
      ) as unknown as Result;
    }
    if (constant && constantAfter === false) {
      reportSetterFailure(
        "constant-after",
        trace,
        failureMode,
        label,
        this,
        displayValue,
        result,
      );
      return result;
    }

    return result;
  } as (this: This, value: Property) => Result;

  return wrapped;
}

function wrapClass<Base extends abstract new (...args: any[]) => object>(
  Base: Base,
  spec: ResolvedSpec,
): Base {
  if (typeof spec.constant !== "function") {
    throw new Error(
      "always class decorator requires { constant: (self) => boolean }",
    );
  }
  const constant = spec.constant;
  const trace = spec.trace;
  const failureOverride = spec.failureMode;
  const methodSpec: ResolvedSpec = {
    constant,
    trace,
    failureMode: failureOverride,
  };
  const setterSpec: ResolvedSpec = {
    constant,
    trace,
    failureMode: failureOverride,
  };

  abstract class Sub extends Base {
    constructor(...args: any[]) {
      super(...args as ConstructorParameters<Base>);
      const result = constant(this);
      if (isPromiseLike(result)) {
        throw new Error(
          "always class decorator invariants must be synchronous during construction",
        );
      }
      if (!result) {
        const cls = getClassName(this);
        emitTrace(trace, { kind: "constant-constructor", class: cls });
        const failureMode = failureOverride ?? getFailureMode();
        handleFailure(failureMode, `Constant failed after constructor: ${cls}`);
      }
    }
  }

  const basePrototype = Base.prototype;
  const keys: (string | symbol)[] = [
    ...Object.getOwnPropertyNames(basePrototype),
    ...Object.getOwnPropertySymbols(basePrototype),
  ];

  for (const key of keys) {
    if (key === "constructor") continue;
    const descriptor = Object.getOwnPropertyDescriptor(basePrototype, key);
    if (!descriptor) continue;

    if (typeof descriptor.value === "function") {
      const original = descriptor.value as (
        ...methodArgs: unknown[]
      ) => unknown;
      const wrapped = wrapMethod(
        original as (this: unknown, ...methodArgs: unknown[]) => unknown,
        String(key),
        methodSpec,
      );
      Object.defineProperty(Sub.prototype, key, {
        configurable: descriptor.configurable ?? true,
        enumerable: descriptor.enumerable ?? false,
        writable: descriptor.writable ?? true,
        value: wrapped,
      });
      continue;
    }

    const { get, set } = descriptor;
    if (typeof get === "function" || typeof set === "function") {
      const wrappedSetter = typeof set === "function"
        ? wrapSetter(
          set as (this: unknown, value: unknown) => unknown,
          String(key),
          setterSpec,
        )
        : undefined;
      Object.defineProperty(Sub.prototype, key, {
        configurable: descriptor.configurable ?? true,
        enumerable: descriptor.enumerable ?? false,
        get: typeof get === "function"
          ? function getter(this: unknown) {
            return get.call(this);
          }
          : undefined,
        set: typeof set === "function" ? wrappedSetter : undefined,
      });
    }
  }

  return Sub as Base;
}

function always(specOrInvariant: unknown) {
  const spec = resolveSpec(specOrInvariant);
  const decorator = (
    value: unknown,
    context:
      | ClassDecoratorContext
      | ClassMethodDecoratorContext<any, (...args: any[]) => any>
      | ClassSetterDecoratorContext<any, any>,
  ) => {
    if (!context || typeof context !== "object" || !("kind" in context)) {
      return value;
    }

    if (context.kind === "method" && typeof value === "function") {
      return wrapMethod(
        value as (this: any, ...args: any[]) => any,
        String(context.name),
        spec,
      );
    }

    if (context.kind === "setter" && typeof value === "function") {
      return wrapSetter(
        value as (this: any, value: any) => any,
        String(context.name),
        spec,
      );
    }

    if (context.kind === "class" && typeof value === "function") {
      return wrapClass(value as abstract new (...args: any[]) => object, spec);
    }

    return value;
  };

  return decorator as {
    <This, Value extends (...args: any[]) => any>(
      value: Value,
      context: ClassMethodDecoratorContext<This, Value>,
    ): Value;
    <This, Property>(
      value: (this: This, value: Property) => void,
      context: ClassSetterDecoratorContext<This, Property>,
    ): (this: This, value: Property) => void;
    <Value extends abstract new (...args: any[]) => object>(
      value: Value,
      context: ClassDecoratorContext<Value>,
    ): Value;
  };
}

export { always, setFailureMode };
export type { FailureMode };
