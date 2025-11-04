# Always — Design-by-Contract decorators for Deno/TypeScript 5

Lightweight TypeScript 5 standard decorators to enforce preconditions (before),
postconditions (after), and invariants (constant). Includes method, setter, and
class-level decorators with friendly tracing.

## Install

Use via URL imports or local module. Example URL import (replace with your repo
path):

```ts
import { always, setFailureMode } from "./mod.ts";
```

This project targets Deno and TypeScript 5 standard decorators.

## Quick start

- Guard a business invariant on a method

```ts
class TicketCounter {
  available = 100;

  @always({
    before: (count: number) => Number.isInteger(count) && count > 0,
    constant: (self: TicketCounter) => self.available >= 0,
    after: (remaining: number) => remaining >= 0,
  })
  sell(count: number) {
    this.available -= count;
    return this.available;
  }
}
```

- Harden a setter

```ts
class CustomerProfile {
  #creditLimit = 5_000;
  get creditLimit() {
    return this.#creditLimit;
  }

  @always({
    before: (value: number) => Number.isFinite(value) && value >= 0,
    constant: (self: CustomerProfile) => self.creditLimit >= 0,
    trace: false,
  })
  set creditLimit(value: number) {
    this.#creditLimit = Math.round(value);
  }
}
```

- Await async predicates

```ts
class InvoiceService {
  outstanding = new Set<string>();

  constructor(
    private readonly send: (
      id: string,
    ) => Promise<{ status: string; id: string }>,
  ) {}

  @always({
    before: async (invoiceId: string) => invoiceId.trim().length > 0,
    constant: async (self: InvoiceService) => self.outstanding.size <= 50,
    after: async (receipt: { status: string }) => receipt.status === "captured",
    trace: false,
  })
  async capture(invoiceId: string) {
    this.outstanding.add(invoiceId);
    const receipt = await this.send(invoiceId);
    this.outstanding.delete(invoiceId);
    return receipt;
  }
}
```

- Class-level invariant (constant)

```ts
@always({ constant: (self: BankAccount) => self.balance >= 0 })
class BankAccount {
  balance = 0;
  deposit(amount: number) {
    this.balance += amount;
  }
  withdraw(amount: number) {
    this.balance -= amount;
  }
}
```

## API

Decorator factory: `always(specOrInvariant)` where `specOrInvariant` is:

- Method/Setter spec
  - `before(...args) => boolean | Promise<boolean>` — precondition
  - `after(result, ...args) => boolean | Promise<boolean>` — postcondition
  - `constant(self) => boolean | Promise<boolean>` — checks object state before
    and after
  - `trace: boolean | (info) => void` — tracing (true by default)
  - `failureMode: "log" | "throw"` — override failure behavior for this spec
  - Aliases: `requires` -> `before`, `ensures` -> `after`

- Class spec
  - `{ constant(self) }` (alias: `invariant`)

Asynchronous predicates are awaited automatically. If any predicate returns a
promise, the decorated method or setter will produce a promise as well. Class
decorators still expect their invariant (`constant`) to resolve synchronously so
the constructor can fail fast when a new instance violates the contract.

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
