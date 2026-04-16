# Testing `@just-in/engine`

Engine-specific testing patterns, sandboxes, and helpers. The shared
philosophy — test layers, layer decision tree, structural rules, `it` naming
conventions, Sinon standards — lives in `TESTING_PHILOSOPHY.md`. Read that
first.

---

## The Two Engine Facades

### `JustInEngine` (DB-backed)

Requires `configureDB(...)` before `init()`. Uses `UserManager`, the event
queue, and `DataManager` under the hood.

| Layer | Infrastructure |
|---|---|
| Unit | Stubs `_coreForTesting.UserManager.init`, `_coreForTesting.shutdownCore`, and queue functions |
| Integration | `MongoMemoryReplSet` |
| E2E | Public API only + `MongoMemoryReplSet` |

### `JustInServerless` (in-memory)

No DB. No `configureDB`. No `init()`. Users are loaded per-invocation via
`loadUsers(...)`.

| Layer | Infrastructure |
|---|---|
| Unit | Stubs `executeEventForUsers` only |
| Integration | Fully in-memory — no infrastructure needed |

---

## The `EngineSandbox` (unit tests)

Every unit test uses `makeEngineSandbox()` from `@just-in/engine/testing`.

| Property | Purpose |
|---|---|
| `sb` | Sinon sandbox. Use for all stubs and spies. Never call `sinon.stub()` directly. |
| `logs` | `LoggerSandbox` — captures log output for assertion. Console output is suppressed. |
| `restore()` | Clears all engine registries then restores all Sinon stubs. Call in `afterEach`. |

**Create in `beforeEach`, not at `describe` level.** The logger sandbox stubs
`GlobalLogger` at creation time. Sharing it across tests means log capture
stops after the first `restore()`.

```ts
// ✅ correct — fresh sandbox per test
let engineSandbox: EngineSandbox;

beforeEach(() => { engineSandbox = makeEngineSandbox(); });
afterEach(() => engineSandbox.restore());
```

```ts
// ❌ wrong — shared sandbox, log assertions fail after first test
const engineSandbox = makeEngineSandbox();
```

---

## Combining with `CoreManagersSandbox`

When a unit test needs to assert on `DataManager` calls, combine
`makeEngineSandbox()` with `makeCoreManagersSandbox()` from
`@just-in/core/testing`:

```ts
let engineSandbox: EngineSandbox;
let coreSandbox: CoreManagersSandbox;
let dm: sinon.SinonStubbedInstance<ReturnType<typeof DataManager.getInstance>>;

beforeEach(() => {
  engineSandbox = makeEngineSandbox();
  coreSandbox = makeCoreManagersSandbox();
  dm = coreSandbox.dm as sinon.SinonStubbedInstance<typeof coreSandbox.dm>;
});

afterEach(() => {
  coreSandbox.restore(); // ← core first
  engineSandbox.restore();
});
```

Casting `coreSandbox.dm` to `SinonStubbedInstance` gives full stub typing
(`.resolves()`, `.rejects()`, `.onFirstCall()`) without per-call casts.

**Restore order matters.** Always restore `coreSandbox` before
`engineSandbox`. Both wrap the same `DataManager` singleton; wrong order
causes sinon "already restored" errors.

---

## Stubbing `_coreForTesting`

`engine.ts` wraps `UserManager` and `shutdownCore` in a plain object so Sinon
can stub them — ES module namespace exports are getter-only and cannot be
stubbed directly:

```ts
import { JustInEngine, _resetEngine, _coreForTesting } from '../engine';

beforeEach(() => {
  engineSandbox.sb.stub(_coreForTesting.UserManager, 'init').resolves();
  engineSandbox.sb.stub(_coreForTesting, 'shutdownCore').resolves();
});
```

`_coreForTesting` is exported from `@just-in/engine/testing` only. Never
reference it in application code.

---

## Stubbing Timers

Always **stub** `timer.start()` — never spy. A spy calls the real function,
starting a real `setInterval` that leaks across tests.

```ts
// ✅ stub — prevents real setInterval
engineSandbox.sb.stub(timer, 'start');

// ❌ spy — still fires the real function
engineSandbox.sb.spy(timer, 'start');
```

Pair `sinon.useFakeTimers()` with `clock.restore()` in `afterEach`, before
`engineSandbox.restore()`, to avoid timer leaks.

---

## Integration Test Setup

### `JustInEngine` (DB-backed)

```ts
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { configureDB, DBType, shutdownCore } from '@just-in/core';
import { waitForMongoReady } from '@just-in/core/testing';

let repl: MongoMemoryReplSet;

beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await waitForMongoReady(repl.getUri());
}, 60_000);

afterAll(async () => {
  await repl.stop();
});

let dbIndex = 0;
function nextDb(): string { return `engine_${dbIndex++}`; }

beforeEach(async () => {
  configureDB({ dbType: DBType.MONGO, uri: repl.getUri(), dbName: nextDb() });
});

afterEach(async () => {
  await shutdownCore();
});
```

Use a single `MongoMemoryReplSet` per file created in `beforeAll` — startup is
expensive. Use `nextDb()` to give every test a unique `dbName`; `shutdownCore()`
closes the connection but never drops the database, so without isolation state
accumulates across tests.

### `JustInServerless` (in-memory)

No infrastructure needed. Each test calls `loadUsers(...)` directly and asserts
on the returned results.

---

## Silencing Logs (integration tests)

Integration tests don't assert on log output and don't use `makeEngineSandbox`.
Use `silenceLogger` from `@just-in/core/testing` to suppress console noise:

```ts
let silenceSb: sinon.SinonSandbox;

beforeAll(() => {
  silenceSb = sinon.createSandbox();
  silenceLogger(silenceSb);
});

afterAll(() => {
  silenceSb.restore();
});
```

---

## Test Helpers

All helpers are available from `@just-in/engine/testing`, which re-exports
`@just-in/core/testing` for convenience.

### Factories

| Helper | Returns |
|---|---|
| `makeEvent(overrides?)` | `JEvent` |
| `makeEngineTestUser(overrides?)` | `JUser` with nested `attributes` |
| `makeTestJUser(overrides?)` | `JUser` (from core) |
| `makeTestNewUserRecord(overrides?)` | `NewUserRecord` (from core) |

### Register helpers

Use when a test needs a registered task or decision rule without caring about
what the steps do:

```ts
const task = registerTestTask({ name: 'myTask' });
// task.shouldActivateSpy, task.doActionSpy available for assertions

const rule = registerTestDecisionRule({ name: 'myRule' });
// rule.shouldActivateSpy, rule.selectActionSpy, rule.doActionSpy
```

Override any step:

```ts
registerTestTask({
  name: 'stopTask',
  shouldActivate: async () => ({ status: 'stop' }),
});
```

Default step implementations return `{ status: 'success' }`.

### Assertion helpers

| Helper | Use |
|---|---|
| `expectStepSuccess(result)` | Asserts `status: 'success'`, returns result |
| `expectStepStop(result)` | Asserts `status: 'stop'`, returns result |
| `expectStepError(result, msg?)` | Asserts `status: 'error'`, returns result |
| `expectEnvelopeSuccess(envelope, step?)` | Asserts envelope step and success status |
| `expectEnvelopeError(envelope, step?)` | Asserts envelope step and error status |
| `expectRecordResult(record, opts?)` | Asserts handler name, step count, activation |
| `expectEngineLog(log, opts?)` | Asserts severity, message, component on a log entry |

---

## Common Pitfalls

**Shared sandbox breaks log capture.**
Create `makeEngineSandbox()` in `beforeEach`, not at `describe` level.

**Restore order in combined sandboxes.**
Always restore `coreSandbox` before `engineSandbox` when using both.

**Stub timers, don't spy.**
`spy(timer, 'start')` starts a real `setInterval`. Use `stub(timer, 'start')`.

**`_setShouldProcessQueue(true)` in `beforeEach` for queue tests.**
`stopEventQueueProcessing()` sets a module-level flag that does not reset
automatically between tests.

**`yarn clean && yarn build` before relinking.**
Core's `dist/` is never cleared by a bare `yarn build`. A stale file can
shadow the correct export and produce confusing runtime errors.
