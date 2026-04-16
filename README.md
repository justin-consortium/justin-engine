# @just-in/engine

The intervention execution layer for the Justin JITAI ecosystem.

`@just-in/engine` takes care of the mechanics of running adaptive interventions
— event queuing, user sweeps, handler execution pipelines, result recording —
so you can focus on writing the clinical logic that makes your study work.

---

## Contents

- [Concepts](#concepts)
- [Installation](#installation)
- [Two Engine Facades](#two-engine-facades)
- [Defining Handlers](#defining-handlers)
    - [Tasks](#tasks)
    - [Decision Rules](#decision-rules)
    - [Step return values](#step-return-values)
    - [Passing data between steps](#passing-data-between-steps)
- [JustInEngine — DB-backed engine](#justin--db-backed-engine)
    - [Startup](#startup)
    - [Registering handlers and events](#registering-handlers-and-events)
    - [Publishing events](#publishing-events)
    - [Interval timers](#interval-timers)
    - [Custom result writers](#custom-result-writers)
    - [Shutdown](#shutdown)
- [JustInServerless — in-memory engine](#justinserverless--in-memory-engine)
    - [Invocation pattern](#invocation-pattern)
    - [Loading users](#loading-users)
    - [Protected attributes](#protected-attributes)
    - [Idempotency keys](#idempotency-keys)
    - [Reset](#reset)
- [Handler execution model](#handler-execution-model)
- [Result recording](#result-recording)
- [Database collections](#database-collections)

---

## Concepts

A **JITAI** (Just-In-Time Adaptive Intervention) delivers personalised support
to study participants at the right moment. The engine models this as:

- **Events** — something happened (a clock tick, a sensor reading, a button
  press). Events trigger the handler pipeline.
- **Tasks** — fetch data, update state, call an API. A Task runs two steps:
  `shouldActivate` → `doAction`.
- **Decision Rules** — decide whether and what kind of intervention to deliver.
  A Decision Rule runs three steps: `shouldActivate` → `selectAction` →
  `doAction`.
- **Users** — the study participants the engine runs handlers for.

Every event triggers a full handler pipeline. Each handler in the pipeline
sweeps across every user before the next handler starts. Within a handler, each
user runs through its steps independently.

---

## Installation

```bash
npm install @just-in/engine
# or
yarn add @just-in/engine
```

`@just-in/core` is a required peer dependency.

---

## Two Engine Facades

| | `JustInEngine` | `JustInServerless` |
|---|---|---|
| **Use when** | Long-running server process | Cloud Run, Lambda, scheduled jobs |
| **DB required** | Yes (MongoDB via `configureDB`) | No |
| **User management** | `UserManager` from `@just-in/core` | `loadUsers()` per invocation |
| **Event queue** | Persisted to MongoDB, change-stream driven | Executed immediately and synchronously |
| **Result storage** | Persisted to MongoDB | Logged at INFO (or custom writer) |
| **State** | Persistent across invocations | Reset between invocations |

---

## Defining Handlers

Handlers are plain objects — there are no classes to extend.

### Tasks

A Task fetches data or updates state. It has two required steps and two
optional lifecycle hooks.

```ts
import { createLogger } from '@just-in/core';
import type { JUser, JEvent } from '@just-in/core';
import type { TaskRegistration, StepReturnResult } from '@just-in/engine';

const Log = createLogger({ context: { package: 'my-study', component: 'fitbit-updater' } });

// Type your user shape for clean field access throughout the handler.
// Fields passed inside `attributes` at creation time are flattened onto the
// top-level JUser record — access them directly, not via a nested object.
type FitbitUser = {
  fitbitToken?: string;
  stepsToday?: number;
};

export const FitbitUpdaterTask: TaskRegistration = {
  name: 'fitbit-updater-task',

  // Optional — runs once before any user is processed
  beforeExecution: async (): Promise<void> => {
    Log.info('Starting Fitbit sync.');
  },

  // Required — return 'success' to proceed to doAction, 'stop' to skip this user
  shouldActivate: async (user: JUser<FitbitUser>, event: JEvent): Promise<StepReturnResult> => {
    if (!user.fitbitToken) {
      return { status: 'stop', result: { reason: 'no Fitbit token' } };
    }
    return { status: 'success', result: { token: user.fitbitToken } };
  },

  // Required — perform the action; receives shouldActivate's result as previousResult
  doAction: async (user: JUser<FitbitUser>, event: JEvent, previousResult: StepReturnResult): Promise<StepReturnResult> => {
    const token = previousResult.result?.['token'] as string;
    const steps = await fetchFitbitSteps(token, event.generatedTimestamp);
    user.stepsToday = steps;
    Log.info(`Updated steps=${steps} for ${user.uniqueIdentifier}.`);
    return { status: 'success', result: { steps } };
  },

  // Optional — runs once after all users have been processed
  afterExecution: async (): Promise<void> => {
    Log.info('Fitbit sync complete.');
  },
};
```

### Decision Rules

A Decision Rule evaluates a user's state and decides whether to intervene.
It has three required steps and two optional lifecycle hooks.

```ts
import type { DecisionRuleRegistration, StepReturnResult } from '@just-in/engine';

type WalkingUser = {
  stepsToday?: number;
  stepGoal?: number;
};

export const WalkingSuggestionRule: DecisionRuleRegistration = {
  name: 'walking-suggestion-rule',

  beforeExecution: async (): Promise<void> => {
    Log.info('Walking suggestion — starting sweep.');
  },

  // Return 'success' to continue, 'stop' to skip this user entirely
  shouldActivate: async (user: JUser<WalkingUser>, event: JEvent): Promise<StepReturnResult> => {
    if (user.stepsToday === undefined) {
      return { status: 'stop', result: { reason: 'no step data available' } };
    }
    const hour = event.generatedTimestamp.getUTCHours();
    if (hour < 9 || hour > 20) {
      return { status: 'stop', result: { reason: 'outside active hours' } };
    }
    return { status: 'success', result: { steps: user.stepsToday } };
  },

  // Return 'success' to proceed to doAction, 'stop' to skip without acting
  selectAction: async (user: JUser<WalkingUser>, event: JEvent, previousResult: StepReturnResult): Promise<StepReturnResult> => {
    const steps = previousResult.result?.['steps'] as number;
    const goal = user.stepGoal ?? 8000;

    if (steps >= goal) {
      return { status: 'stop', result: { reason: 'goal already met' } };
    }

    // Probabilistic gate — only nudge 60% of eligible users
    if (Math.random() > 0.6) {
      return { status: 'stop', result: { reason: 'random gate' } };
    }

    const remaining = goal - steps;
    return {
      status: 'success',
      result: {
        action: 'SEND_MESSAGE',
        message: `${remaining} steps to your goal — let's go!`,
      },
    };
  },

  // Deliver the intervention
  doAction: async (user: JUser<WalkingUser>, event: JEvent, previousResult: StepReturnResult): Promise<StepReturnResult> => {
    if (previousResult.result?.['action'] === 'SEND_MESSAGE') {
      await sendPushNotification(user, previousResult.result['message'] as string);
      Log.info(`Sent message to ${user.uniqueIdentifier}.`);
    }
    return { status: 'success', result: previousResult.result };
  },

  afterExecution: async (): Promise<void> => {
    Log.info('Walking suggestion — sweep complete.');
  },
};
```

### Step return values

Every step returns a `StepReturnResult`:

```ts
type StepStatus = 'success' | 'stop' | 'error';

type StepReturnResult<T = Record<string, unknown>> = {
  status: StepStatus;
  result?: T;       // forwarded as previousResult to the next step
  error?: unknown;  // present when status is 'error'
};
```

| Status | Meaning |
|---|---|
| `'success'` | Step completed normally. Continue to the next step. |
| `'stop'` | Skip this user gracefully. Not an error — just nothing to do. |
| `'error'` | Something went wrong. The engine logs it and moves to the next user. |

The engine catches uncaught exceptions from step functions and automatically
wraps them as `{ status: 'error' }` — you do not need to try/catch inside
steps unless you want to handle the error yourself.

### Passing data between steps

The `result` field of each step's return value is forwarded as `previousResult`
to the next step. This is the primary mechanism for carrying computed values
through the handler pipeline.

```ts
shouldActivate: async (user, event) => {
  const decisionPoint = computeDecisionPoint(event.generatedTimestamp);
  return { status: 'success', result: { decisionPoint } };
},

selectAction: async (user, event, previousResult) => {
  const { decisionPoint } = previousResult.result;
  const message = selectMessage(user, decisionPoint);
  return { status: 'success', result: { action: 'SEND', message } };
},

doAction: async (user, event, previousResult) => {
  await sendMessage(user, previousResult.result.message);
  return { status: 'success', result: previousResult.result };
},
```

---

## JustInEngine — DB-backed engine

### Startup

```ts
import { configureDB, DBType, UserManager } from '@just-in/core';
import { JustInEngine } from '@just-in/engine';

// 1. Configure the database connection (call once at startup)
configureDB({
  dbType: DBType.MONGO,
  uri: process.env.MONGO_URI,
  dbName: 'my_study',
});

// 2. Register handlers before calling init
JustInEngine.registerTask(FitbitUpdaterTask);
JustInEngine.registerDecisionRule(WalkingSuggestionRule);

await JustInEngine.registerEventHandlers('CLOCK_EVENT', [
  FitbitUpdaterTask.name,
  WalkingSuggestionRule.name,
]);

// 3. Init wires DataManager, UserManager, and change stream listeners
await JustInEngine.init();

// 4. Start processing — wires the event queue listener and drains any
//    events that arrived before this process started
await JustInEngine.startEngine();
```

Handler registration order within an event determines execution order. Tasks
that write data to user fields must appear before Decision Rules that read them.

### Registering handlers and events

```ts
JustInEngine.registerTask(MyTask);
JustInEngine.registerDecisionRule(MyRule);

// Register an ordered handler array for an event type
await JustInEngine.registerEventHandlers('MY_EVENT', [
  MyTask.name,
  MyRule.name,
]);

// Replace an existing registration
await JustInEngine.registerEventHandlers('MY_EVENT', [MyTask.name], true);

// Remove a registration
JustInEngine.unregisterEventHandlers('MY_EVENT');
```

### Publishing events

Events are inserted into the `event_queue` collection. The change stream
listener picks them up and calls `processEventQueue` automatically. You can
also publish from anywhere in your application — for example, in response to
an incoming webhook or sensor reading.

```ts
// Minimal
await JustInEngine.publishEvent('CLOCK_EVENT', new Date());

// With event details — forwarded to all handlers as event.eventDetails
await JustInEngine.publishEvent('SENSOR_EVENT', new Date(), {
  heartRate: 82,
  trigger: 'wrist_motion',
  messageId: cloudMessage.id,
});
```

### Interval timers

Register a timer that publishes events on a fixed schedule. Timers are not
started until `startEngine()` is called.

```ts
// Real-time: publish every 15 minutes
JustInEngine.createIntervalTimerEventGenerator('CLOCK_EVENT', 15 * 60 * 1000);

// Simulated: replay 7 days of 15-minute ticks at 10ms per tick
// Useful for backfill or accelerated local testing
JustInEngine.createIntervalTimerEventGenerator('CLOCK_EVENT', 15 * 60 * 1000, {
  simulatedStartDate: new Date('2024-01-01T00:00:00Z'),
  simulatedTickDurationInMs: 10,
  simulatedTickCountMax: 7 * 24 * 4,  // 7 days × 4 ticks/hour
});

await JustInEngine.init();
await JustInEngine.startEngine();  // timers start here
```

### Custom result writers

By default, handler results are persisted to the `task_results` and
`decision_rule_results` MongoDB collections. Replace this with your own
writer to route results to an analytics pipeline, data warehouse, or any
other destination.

```ts
JustInEngine.configureTaskResultWriter(async (record) => {
  await myAnalytics.track('task_result', {
    handler: record.name,
    user: record.user.uniqueIdentifier,
    event: record.event.eventType,
    steps: record.steps,
  });
});

JustInEngine.configureDecisionRuleResultWriter(async (record) => {
  await myDataWarehouse.insert('decision_rule_results', record);
});
```

A single Decision Rule writer also handles Task results when no Task writer
is configured. Set both to have full independent control.

### Shutdown

```ts
await JustInEngine.shutdown();
```

Wire this to your process signal handlers so in-flight events complete before
the process exits:

```ts
process.on('SIGTERM', async () => {
  await JustInEngine.shutdown();
  process.exit(0);
});
```

---

## JustInServerless — in-memory engine

### Invocation pattern

`JustInServerless` is designed for short-lived execution contexts where there
is no persistent process. Each invocation is self-contained: load users,
register handlers, publish the event, reset. Wrap everything in a try/finally
to ensure `reset()` always runs even if an error occurs.

```ts
import { JustInServerless } from '@just-in/engine';

export const handleCloudEvent = async (cloudEvent: CloudEvent): Promise<void> => {
  try {
    await JustInServerless.loadUsers(await fetchUsersFromAPI());

    JustInServerless.registerTask(FitbitUpdaterTask);
    JustInServerless.registerDecisionRule(WalkingSuggestionRule);

    await JustInServerless.registerEventHandlers('CLOCK_EVENT', [
      FitbitUpdaterTask.name,
      WalkingSuggestionRule.name,
    ]);

    // publishEvent executes the full pipeline synchronously —
    // when this resolves, all handlers have completed for all users
    await JustInServerless.publishEvent(
      'CLOCK_EVENT',
      new Date(cloudEvent.time),
      { messageId: cloudEvent.id },
    );
  } finally {
    JustInServerless.reset();
  }
};
```

### Loading users

`loadUsers` accepts either `NewUserRecord` (no `id` field) or fully persisted
`JUser` objects. The engine derives `id` from `uniqueIdentifier` when no `id`
is provided. Each call atomically replaces the previous user set.

```ts
// From a source that returns NewUserRecord shape.
// Fields inside `attributes` are flattened onto the user record —
// after loading, they are accessible directly as user.stepGoal, not user.attributes.stepGoal.
await JustInServerless.loadUsers([
  { uniqueIdentifier: 'alice', attributes: { stepGoal: 8000 } },
  { uniqueIdentifier: 'bob',   attributes: { stepGoal: 6000 } },
]);

// From an external API returning full JUser objects
await JustInServerless.loadUsers(await myApi.getActiveParticipants());
```

After loading, users are accessible for the duration of the invocation:

```ts
JustInServerless.getAllUsers();
JustInServerless.getUserById('alice');
JustInServerless.getUserByUniqueIdentifier('alice');
```

### Protected attributes

Load sensitive data (health metrics, PII) alongside users using namespaced
protected attributes. These are stored separately from `attributes` and
accessed by namespace name inside handlers.

```ts
await JustInServerless.loadUsers([
  {
    uniqueIdentifier: 'alice',
    attributes: { cohort: 'A' },
    protectedAttributes: [
      {
        namespace: 'health',
        protectedAttributes: { heartRate: 72, sleepHours: 7.5 },
      },
      {
        namespace: 'pii',
        protectedAttributes: { email: 'alice@example.com' },
      },
    ],
  },
]);

// Inside a handler — request specific namespaces
doAction: async (user, event) => {
  const [health] = JustInServerless.getProtectedAttributesByNamespace(user.id, ['health']);
  const heartRate = health?.protectedAttributes?.['heartRate'] as number;
  // ...
},

// Request all namespaces for a user
const allRecords = JustInServerless.getAllProtectedAttributesForUser(user.id);
```

### Idempotency keys

Pass an idempotency key as the fourth argument to `publishEvent` to prevent
duplicate execution if the same event is delivered more than once — for
example from a Pub/Sub retry or a Cloud Run re-invocation.

```ts
await JustInServerless.publishEvent(
  'CLOCK_EVENT',
  new Date(cloudEvent.time),
  { messageId: cloudEvent.id },
  cloudEvent.id,   // ← duplicate calls with this key are skipped
);
```

Idempotency keys are cleared by `reset()`, so the same key can safely be
reused across separate invocations.

### Reset

`reset()` clears all engine state — users, registered handlers, event
registrations, idempotency keys, and result writer configuration.

```ts
try {
  // ... invocation logic
} finally {
  JustInServerless.reset();
}
```

---

## Handler execution model

Understanding the execution order matters when handlers share data by writing
fields onto the user object.

```
Event published
│
└─► Handler 1 — FitbitUpdaterTask
│     ├─ beforeExecution()               ← once, before any user
│     ├─ User A: shouldActivate → doAction
│     ├─ User B: shouldActivate → doAction
│     ├─ User C: shouldActivate returns 'stop' → doAction skipped
│     └─ afterExecution()                ← once, after all users
│
└─► Handler 2 — WalkingSuggestionRule
      ├─ beforeExecution()
      ├─ User A: shouldActivate → selectAction → doAction
      ├─ User B: shouldActivate returns 'stop' → selectAction, doAction skipped
      ├─ User C: shouldActivate → selectAction returns 'stop' → doAction skipped
      └─ afterExecution()
```

Key properties of this model:

**Handler sweep is sequential.** All users complete Handler 1 before any user
starts Handler 2. Handler 2 can safely read fields written onto the user object by Handler 1.

**User sweep within a handler is sequential.** Users are processed one at a
time in a consistent order.

**Per-user errors are isolated.** If a step throws for one user, that user's
execution is aborted and the error is logged. The remaining users continue
unaffected.

**`stop` is not an error.** Returning `{ status: 'stop' }` skips the remaining
steps for that user cleanly — nothing is logged as a warning and no result
record is produced.

---

## Result recording

After each handler completes execution for a user the engine produces a
`RecordResult` — one per handler per user per event:

```ts
type RecordResult = {
  event: JEvent;             // the triggering event
  name: string;              // handler name
  user: JUser;               // the user this record is for
  steps: ExecuteStepReturn[];  // timestamped result of each step that ran
};
```

**DB-backed engine** — persisted to `task_results` or `decision_rule_results`
by default. Override with a custom writer via `configureTaskResultWriter` or
`configureDecisionRuleResultWriter`.

**Serverless engine** — logged at INFO level by default (cloud stdout is the
audit trail). Override with a custom writer to silence the default logging or
route records to your own storage:

```ts
// Route to your own storage and silence the default log output
JustInServerless.configureTaskResultWriter(async (record) => {
  await myStorage.save(record);
});

// Silence entirely
JustInServerless.configureTaskResultWriter(async () => {});
JustInServerless.configureDecisionRuleResultWriter(async () => {});
```

---

## Database collections

The DB-backed engine uses four MongoDB collections:

| Collection | Contents |
|---|---|
| `event_queue` | Events awaiting processing. Normally empty — events are removed after archiving. |
| `archived_events` | Every event that has been processed. Full audit trail. |
| `task_results` | One document per Task per user per event. |
| `decision_rule_results` | One document per Decision Rule per user per event. |

Query them directly via `DataManager` from `@just-in/core`:

```ts
import { DataManager } from '@just-in/core';

const dm = DataManager.getInstance();
const results = await dm.getAllInCollection<MyResultType>('decision_rule_results');
```
