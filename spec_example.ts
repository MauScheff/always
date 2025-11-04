type MethodSpec<T extends (...args: any[]) => any> = {
  requires?: (...args: Parameters<T>) => boolean;
  ensures?: (result: ReturnType<T>, ...args: Parameters<T>) => boolean;
};

type Invariant<T> = (obj: T) => boolean;

// TS 5+ standard decorators implementation
type AnyConstructor = new (...args: any[]) => any;

function Spec<TCtor extends AnyConstructor>(
  invariant: (obj: InstanceType<TCtor>) => boolean,
): (value: TCtor, context: ClassDecoratorContext<TCtor>) => TCtor | void;
function Spec<TMethod extends (...args: any[]) => any>(
  spec: MethodSpec<TMethod>,
): (value: TMethod, context: ClassMethodDecoratorContext) => TMethod | void;
function Spec(specOrInvariant: any) {
  return function (
    value: any,
    context: ClassDecoratorContext | ClassMethodDecoratorContext,
  ) {
    if (context.kind === "method") {
      const original = value as (...args: any[]) => any;
      const name = String(context.name);
      return function (this: any, ...args: any[]) {
        if (specOrInvariant?.requires && !specOrInvariant.requires(...args)) {
          throw new Error(`Precondition failed for ${name}`);
        }
        const result = original.apply(this, args);
        if (specOrInvariant?.ensures && !specOrInvariant.ensures(result, ...args)) {
          throw new Error(`Postcondition failed for ${name}`);
        }
        return result;
      };
    }

    if (context.kind === "class") {
      const Base = value as new (...args: any[]) => any;
      return class extends Base {
        constructor(...args: any[]) {
          super(...args);
          // Wrap all instance methods to check invariant before and after
          const proto = Base.prototype;
          const methods = Object.getOwnPropertyNames(proto)
            .filter((m) => m !== "constructor" && typeof (this as any)[m] === "function");
          for (const method of methods) {
            const orig = (this as any)[method];
            (this as any)[method] = (...mArgs: any[]) => {
              if (!specOrInvariant(this)) {
                throw new Error(`Invariant failed before ${method}`);
              }
              const result = orig.apply(this, mArgs);
              if (!specOrInvariant(this)) {
                throw new Error(`Invariant failed after ${method}`);
              }
              return result;
            };
          }
        }
      };
    }

    // For other kinds (get/set/field), we don't support
    return undefined;
  } as any;
}

// ================== Example Usage ==================

@Spec((self: BankAccount) => self.balance >= 0) // class-level invariant
class BankAccount {
  constructor(public balance: number) {}

  @Spec({
    requires: (amount: number) => amount > 0,
    ensures: (result: void, amount: number) => true,
  })
  deposit(amount: number) {
    this.balance += amount;
  }

  @Spec({
    requires: (amount: number) => amount > 0,
    ensures: (result: void, amount: number) => true,
  })
  withdraw(amount: number) {
    this.balance -= amount;
  }
}

// ========== Test ==========
const account = new BankAccount(100);
account.deposit(50);
account.withdraw(30);
account.withdraw(150); // Throws: invariant failed
