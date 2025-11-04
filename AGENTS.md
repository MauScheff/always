# Repository Guidelines

## Project Structure & Module Organization

The root `main.ts` exports the `always` decorator and failure-mode helpers; keep
this module focused on runtime behavior. Place new unit tests in `tests/` using
the `*_test.ts` suffix so `deno test` auto-discovers them. Shared fixtures
belong beside the tests that consume them. Configuration lives in `deno.json`
(tasks and import map), `tsconfig.json` (decorator/emit flags for TypeScript
tooling), and `deno.lock` (version pinning); update these files in tandem with
changes that require them.

## Build, Test, and Development Commands

Use `deno task dev` for a quick local feedback loop; it runs `main.ts` with file
watching enabled. Run `deno task test` to execute the full test suite with all
permissions (`-A`). Format code with `deno fmt` and lint with `deno lint` before
sending patches—both respect the repository settings without extra flags.

## Coding Style & Naming Conventions

Follow Deno’s formatter defaults (two-space indentation, trailing commas where
allowed). Favor readable names that mirror the contract being enforced;
decorators that expose public API should remain snake-free and descriptive
(e.g., `checkInvariant`). Keep helper utilities private unless they are
intentionally exported. Type annotations should be explicit on public functions.
Avoid side effects at module top-level beyond exports.

## Testing Guidelines

Write tests with the built-in `Deno.test` API and `@std/assert` helpers. Name
tests after the behavior under contract (e.g.,
`Deno.test("always rejects failing before clause", ...)`). New behavior must
include positive and failure-path coverage. When introducing async or
resource-sensitive logic, stub external effects rather than expanding the
permission surface granted by `-A`.

## Commit & Pull Request Guidelines

Commits follow a Conventional Commit style (`feat:`, `fix:`, `refactor:`) as
seen in history; keep messages in the imperative and scoped to a single concern.
Before opening a PR, include: a succinct summary of the change, references to
related issues, screenshots or trace output if behavior changed, and the command
results for `deno fmt` and `deno task test`. Small, focused PRs review faster
and ease regression tracking.

## Security & Configuration Notes

Tests run with full permissions; never introduce network or filesystem usage in
decorators without gating it behind explicit opt-in flags. If you add new tasks
or tooling, wire them through `deno.json` so contributors can rely on a single
command surface.
