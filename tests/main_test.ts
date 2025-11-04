import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import type { FailureMode } from "../mod.ts";
import { always, setFailureMode } from "../mod.ts";

async function withFailureMode(
  mode: FailureMode,
  fn: () => void | Promise<void>,
): Promise<void> {
  const previous = setFailureMode(mode);
  try {
    await fn();
  } finally {
    setFailureMode(previous);
  }
}

Deno.test("always decorator respects failure modes", async (t) => {
  await t.step("default log mode logs without throwing", async () => {
    await withFailureMode("log", async () => {
      class Probe {
        calls = 0;

        @always({ before: () => false, trace: false })
        run() {
          this.calls += 1;
        }
      }

      const p = new Probe();
      const captured: unknown[][] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        captured.push(args);
      };

      try {
        p.run();
      } finally {
        console.error = originalError;
      }

      assertEquals(p.calls, 0);
      assertEquals(captured.length, 1);
      const [message] = captured[0];
      assert(
        typeof message === "string" && message.includes("Before failed"),
        "expected log message to mention 'Before failed'",
      );
    });
  });

  await t.step(
    "spec failureMode override throws even in log mode",
    async () => {
      await withFailureMode("log", () => {
        class Override {
          @always({ before: () => false, failureMode: "throw", trace: false })
          run() {}
        }

        const o = new Override();
        assertThrows(() => o.run(), Error, "Before failed");
      });
    },
  );

  await t.step("throw mode regression suite", async (suite) => {
    await withFailureMode("throw", async () => {
      await suite.step("smoke: method before failure throws", () => {
        class A {
          @always({ before: (n: number) => n > 0, trace: false })
          inc(_n: number) {}
        }
        const a = new A();
        assertThrows(() => a.inc(0));
      });

      class Counter {
        value = 0;

        @always({ constant: (self: Counter) => self.value >= 0, trace: false })
        inc(delta: number) {
          this.value += delta;
        }
      }

      await suite.step("method constant passes when state stays valid", () => {
        const c = new Counter();
        c.inc(1);
        assertEquals(c.value, 1);
      });

      await suite.step(
        "method constant fails when state becomes invalid",
        () => {
          const c = new Counter();
          assertThrows(() => c.inc(-1));
        },
      );

      await suite.step("method: before/constant/after", () => {
        class Wallet {
          amount = 0;

          @always({
            before: (n: number) => Number.isFinite(n),
            constant: (self: Wallet) => self.amount >= 0,
            after: (_: void, n: number) => typeof n === "number",
            trace: false,
          })
          add(n: number) {
            this.amount += n;
          }
        }

        const w = new Wallet();
        w.add(10);
        assertEquals(w.amount, 10);
        assertThrows(() => w.add(-20), Error, "Constant failed after");

        const w2 = new Wallet();
        assertThrows(() => w2.add(NaN), Error, "Before failed");
      });

      await suite.step("method: after failure", () => {
        class Greeter {
          @always({
            after: (result: string) => result.length > 0,
            trace: false,
          })
          greet(name: string) {
            return name.trim();
          }
        }

        const g = new Greeter();
        assertEquals(g.greet(" Alice "), "Alice");
        assertThrows(() => g.greet("   "), Error, "After failed");
      });

      await suite.step("setter: before/constant", () => {
        class PersonTest {
          #age = 0;
          get age() {
            return this.#age;
          }

          @always({
            before: (val: number) => Number.isInteger(val) && val >= 0,
            constant: (self: PersonTest) => self.age >= 0,
            trace: false,
          })
          set age(val: number) {
            this.#age = val;
          }
        }

        const p = new PersonTest();
        p.age = 5;
        assertEquals(p.age, 5);
        assertThrows(
          () => {
            (p as unknown as { age: number }).age = -1;
          },
          Error,
          "Before failed",
        );
      });

      await suite.step("class: constant wraps", () => {
        @always({
          constant: (self: Account) => self.balance >= 0,
          trace: false,
        })
        class Account {
          balance = 0;

          deposit(n: number) {
            this.balance += n;
          }
          withdraw(n: number) {
            this.balance -= n;
          }

          get flag() {
            return this.balance > 0;
          }
          set flag(_v: boolean) {/* no-op */}
        }

        const a = new Account();
        a.deposit(50);
        assertEquals(a.balance, 50);
        assertThrows(() => a.withdraw(100), Error, "Constant failed after");
      });

      await suite.step("aliases: requires/ensures", () => {
        class MathOps {
          @always({
            requires: (a: number, b: number) =>
              Number.isFinite(a) && Number.isFinite(b),
            ensures: (r: number) => typeof r === "number",
            trace: false,
          })
          sum(a: number, b: number) {
            return a + b;
          }
        }

        const m = new MathOps();
        assertEquals(m.sum(1, 2), 3);
        assertThrows(() => m.sum(NaN as number, 1), Error, "Before failed");
      });

      await suite.step("alias: invariant -> constant", () => {
        @always({ invariant: (self: AliasA) => self.n >= 0, trace: false })
        class AliasA {
          n = 0;
          add(x: number) {
            this.n += x;
          }
        }

        const a = new AliasA();
        a.add(1);
        assertThrows(() => a.add(-5), Error, "Constant failed after");
      });

      await suite.step("trace: custom handler captures events", () => {
        const logs: unknown[] = [];
        class TraceProbe {
          @always({
            before: () => false,
            trace: (info: unknown) => logs.push(info),
          })
          foo() {}
        }
        const probe = new TraceProbe();
        assertThrows(() => probe.foo(), Error, "Before failed");
        assert(logs.length > 0, "Expected trace logs");
        assert(
          (logs as { kind?: string }[]).some((l) => l.kind === "before"),
          "Expected 'before' trace kind",
        );
      });

      await suite.step("trace: disabled with trace:false", () => {
        class TraceOff {
          @always({ before: () => false, trace: false })
          foo() {}
        }
        const off = new TraceOff();
        assertThrows(() => off.foo(), Error, "Before failed");
      });
    });
  });
});

Deno.test("always supports async predicates", async (t) => {
  await withFailureMode("throw", async () => {
    await t.step(
      "method awaits async before/after/constant and result",
      async () => {
        class AsyncMath {
          calls = 0;

          @always({
            before: async (n: number) => {
              await Promise.resolve();
              return n >= 0;
            },
            after: async (result: number, n: number) => {
              await Promise.resolve();
              return n === 99 || result % 4 === 0;
            },
            constant: async (self: AsyncMath) => {
              await Promise.resolve();
              return self.calls >= 0;
            },
            trace: false,
          })
          async double(n: number) {
            await Promise.resolve();
            if (n === 99) {
              this.calls = -1;
            } else {
              this.calls += 1;
            }
            return n * 2;
          }
        }

        const m = new AsyncMath();
        assertEquals(await m.double(2), 4);
        await assertRejects(
          async () => await m.double(-1),
          Error,
          "Before failed",
        );
        await assertRejects(
          async () => await m.double(1),
          Error,
          "After failed",
        );
        await assertRejects(
          async () => await m.double(99),
          Error,
          "Constant failed after",
        );
      },
    );

    await t.step("class constant wraps async methods", async () => {
      @always({
        constant: (self: AsyncAccount) => self.balance >= 0,
        trace: false,
      })
      class AsyncAccount {
        balance = 0;

        async deposit(n: number) {
          await Promise.resolve();
          this.balance += n;
        }

        async withdraw(n: number) {
          await Promise.resolve();
          this.balance -= n;
        }
      }

      const account = new AsyncAccount();
      await account.deposit(10);
      assertEquals(account.balance, 10);
      await assertRejects(
        async () => await account.withdraw(20),
        Error,
        "Constant failed after",
      );
    });
  });
});
