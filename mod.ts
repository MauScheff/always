// deno-lint-ignore-file no-explicit-any
type TraceOption = boolean | ((info: Record<string, unknown>) => void);
type FailureMode = "log" | "throw";

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

type ResolvedSpec = {
  before?: (...args: unknown[]) => boolean;
  after?: (result: unknown, ...args: unknown[]) => boolean;
  constant?: (self: unknown) => boolean;
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

function wrapMethod<This, Value extends (this: This, ...args: any[]) => any>(
  original: Value,
  label: string,
  spec: ResolvedSpec,
): Value {
  const { before, after, constant, trace } = spec;
  const wrapped = function (
    this: This,
    ...args: Parameters<Value>
  ): ReturnType<Value> {
    const displayArgs = args as unknown[];
    const failureMode = spec.failureMode ?? getFailureMode();
    if (constant && !constant(this)) {
      const cls = getClassName(this);
      emitTrace(trace, {
        kind: "constant-before",
        class: cls,
        name: label,
        args: displayArgs,
      });
      handleFailure(
        failureMode,
        `Constant failed before: ${cls}.${label}(${formatArgs(displayArgs)})`,
      );
      return undefined as ReturnType<Value>;
    }
    if (before && !before(...displayArgs)) {
      const cls = getClassName(this);
      emitTrace(trace, {
        kind: "before",
        class: cls,
        name: label,
        args: displayArgs,
      });
      handleFailure(
        failureMode,
        `Before failed: ${cls}.${label}(${formatArgs(displayArgs)})`,
      );
      return undefined as ReturnType<Value>;
    }
    const result = original.apply(this, args);
    if (after && !after(result as unknown, ...displayArgs)) {
      const cls = getClassName(this);
      emitTrace(trace, {
        kind: "after",
        class: cls,
        name: label,
        args: displayArgs,
        result,
      });
      handleFailure(
        failureMode,
        `After failed: ${cls}.${label}(${formatArgs(displayArgs)}) -> ${
          formatValue(result)
        }`,
      );
      return result as ReturnType<Value>;
    }
    if (constant && !constant(this)) {
      const cls = getClassName(this);
      emitTrace(trace, {
        kind: "constant-after",
        class: cls,
        name: label,
        args: displayArgs,
        result,
      });
      handleFailure(
        failureMode,
        `Constant failed after: ${cls}.${label}(${
          formatArgs(displayArgs)
        }) -> ${formatValue(result)}`,
      );
      return result as ReturnType<Value>;
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
  const { before, after, constant, trace } = spec;
  const wrapped = function (this: This, value: Property): Result {
    const displayValue = value as unknown;
    const failureMode = spec.failureMode ?? getFailureMode();
    if (constant && !constant(this)) {
      const cls = getClassName(this);
      emitTrace(trace, {
        kind: "constant-before",
        class: cls,
        name: `${label} (setter)`,
        value: displayValue,
      });
      handleFailure(
        failureMode,
        `Constant failed before: ${cls}.set ${label}(${
          formatValue(displayValue)
        })`,
      );
      return undefined as Result;
    }
    if (before && !before(displayValue)) {
      const cls = getClassName(this);
      emitTrace(trace, {
        kind: "setter-before",
        class: cls,
        name: label,
        value: displayValue,
      });
      handleFailure(
        failureMode,
        `Before failed: ${cls}.set ${label}(${formatValue(displayValue)})`,
      );
      return undefined as Result;
    }
    const result = original.call(this, value);
    if (after && !after(result as unknown, displayValue)) {
      const cls = getClassName(this);
      emitTrace(trace, {
        kind: "setter-after",
        class: cls,
        name: label,
        value: displayValue,
        result,
      });
      handleFailure(
        failureMode,
        `After failed: ${cls}.set ${label}(${formatValue(displayValue)}) -> ${
          formatValue(result)
        }`,
      );
      return result as Result;
    }
    if (constant && !constant(this)) {
      const cls = getClassName(this);
      emitTrace(trace, {
        kind: "constant-after",
        class: cls,
        name: `${label} (setter)`,
        value: displayValue,
        result,
      });
      handleFailure(
        failureMode,
        `Constant failed after: ${cls}.set ${label}(${
          formatValue(displayValue)
        }) -> ${formatValue(result)}`,
      );
      return result as Result;
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

  abstract class Sub extends Base {
    constructor(...args: any[]) {
      super(...args as ConstructorParameters<Base>);
      if (!constant(this)) {
        const cls = getClassName(this);
        emitTrace(trace, { kind: "constant-constructor", class: cls });
        const failureMode = spec.failureMode ?? getFailureMode();
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
      // Preserve original descriptor attributes while layering invariant checks.
      Object.defineProperty(Sub.prototype, key, {
        configurable: descriptor.configurable ?? true,
        enumerable: descriptor.enumerable ?? false,
        writable: descriptor.writable ?? true,
        value: function (this: unknown, ...methodArgs: unknown[]) {
          const label = String(key);
          const failureMode = spec.failureMode ?? getFailureMode();
          if (!constant(this)) {
            const cls = getClassName(this);
            emitTrace(trace, {
              kind: "constant-before",
              class: cls,
              name: label,
              args: methodArgs,
            });
            handleFailure(
              failureMode,
              `Constant failed before: ${cls}.${label}(${
                formatArgs(methodArgs)
              })`,
            );
            return undefined;
          }
          const result = original.apply(this, methodArgs);
          if (!constant(this)) {
            const cls = getClassName(this);
            emitTrace(trace, {
              kind: "constant-after",
              class: cls,
              name: label,
              args: methodArgs,
              result,
            });
            handleFailure(
              failureMode,
              `Constant failed after: ${cls}.${label}(${
                formatArgs(methodArgs)
              }) -> ${formatValue(result)}`,
            );
          }
          return result;
        },
      });
      continue;
    }

    const { get, set } = descriptor;
    if (typeof get === "function" || typeof set === "function") {
      Object.defineProperty(Sub.prototype, key, {
        configurable: descriptor.configurable ?? true,
        enumerable: descriptor.enumerable ?? false,
        get: typeof get === "function"
          ? function getter(this: unknown) {
            return get.call(this);
          }
          : undefined,
        set: typeof set === "function"
          ? function setter(this: unknown, value: unknown) {
            const label = String(key);
            const failureMode = spec.failureMode ?? getFailureMode();
            if (!constant(this)) {
              const cls = getClassName(this);
              emitTrace(trace, {
                kind: "constant-before",
                class: cls,
                name: `${label} (setter)`,
                value,
              });
              handleFailure(
                failureMode,
                `Constant failed before: ${cls}.set ${label}(${
                  formatValue(value)
                })`,
              );
              return;
            }
            const result = set.call(this, value);
            if (!constant(this)) {
              const cls = getClassName(this);
              emitTrace(trace, {
                kind: "constant-after",
                class: cls,
                name: `${label} (setter)`,
                value,
                result,
              });
              handleFailure(
                failureMode,
                `Constant failed after: ${cls}.set ${label}(${
                  formatValue(value)
                }) -> ${formatValue(result)}`,
              );
            }
            return result;
          }
          : undefined,
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
