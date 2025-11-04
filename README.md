# Always — Design-by-Contract decorators for Deno/TypeScript 5

Lightweight TypeScript 5 standard decorators to enforce preconditions (before),
postconditions (after), and invariants (constant). Includes method, setter, and
class-level decorators with friendly tracing.

## Install

Use via URL imports or local module. Example URL import (replace with your repo
path):

```ts
import { always, setFailureMode } from "./main.ts";
```

This project targets Deno and TypeScript 5 standard decorators.

## Quick start

- Method pre/post/constant

```ts
class Wallet {
  amount = 0;

  @always({
    before: (n: number) => Number.isFinite(n),
    constant: (self: Wallet) => self.amount >= 0,
    after: () => true,
  })
  add(n: number) {
    this.amount += n;
  }
}
```

- Setter pre/post/constant

```ts
class Person {
  #age = 0;
  get age() {
    return this.#age;
  }

  @always({ before: (v: number) => v >= 0, after: () => true })
  set age(v: number) {
    this.#age = v;
  }
}
```

- Class-level invariant (constant)

```ts
@always({ constant: (self: BankAccount) => self.balance >= 0 })
class BankAccount {
  balance = 0;
  deposit(n: number) {
    this.balance += n;
  }
  withdraw(n: number) {
    this.balance -= n;
  }
}
```

## API

Decorator factory: `always(specOrInvariant)` where `specOrInvariant` is:

- Method/Setter spec
  - `before(...args) => boolean` — precondition
  - `after(result, ...args) => boolean` — postcondition
  - `constant(self) => boolean` — checks object state before and after
  - `trace: boolean | (info) => void` — tracing (true by default)
  - `failureMode: "log" | "throw"` — override failure behavior for this spec
  - Aliases: `requires` -> `before`, `ensures` -> `after`

- Class spec
  - `{ constant(self) }` (alias: `invariant`)

### Failure handling

- Failures log by default; call `setFailureMode("throw")` to switch to throwing
  globally.
- Toggle per decorator with the `failureMode` field above.

### Tracing

- Enabled by default. Pass `trace: false` to disable, or a function to capture
  events.
- Trace event info includes `{ kind, class, name, args, result }` depending on
  context.

### Error messages

- Before: `Before failed: ClassName.method(args)`
- After: `After failed: ClassName.method(args) -> result`
- Constant before/after:
  `Constant failed before/after: ClassName.method(args) -> result`

## Testing

- Run tests with Deno:

```sh
deno task test
```

Tests live in `*_test.ts` files and use `@std/assert`.

## Notes

- Uses TypeScript 5 standard decorators (`context.kind` for
  class/method/setter).
- Class-level invariant wraps all instance methods and setters.
- No side effects on import; module exports `{ always, setFailureMode }` only.

## License

MIT
