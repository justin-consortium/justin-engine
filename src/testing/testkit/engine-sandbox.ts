import sinon from 'sinon';
import type { SinonSandbox } from 'sinon';
import { makeLoggerSandbox } from '@just-in/core/testing';
import type { LoggerSandbox } from '@just-in/core/testing';
import { EventHandlerManager } from '../../event/manager';
import { _clearRegisteredTasks, _clearRegisteredDecisionRules,  __resetResultRecorderForTests } from '../../handlers';
import { resetRegisterCounters } from '../helpers/register';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The engine test sandbox returned by {@link makeEngineSandbox}.
 *
 * Provides a Sinon sandbox for stub/spy creation, a logger sandbox for
 * asserting on log output, and coordinated `reset` / `restore` lifecycle
 * methods that keep all engine singletons and registries clean between tests.
 */
type EngineSandbox = {
  /**
   * The underlying Sinon sandbox.
   *
   * Use this for all stubs and spies — never call `sinon.stub()` directly
   * in engine tests. Stubs created here are restored automatically by
   * `restore()`.
   */
  sb: SinonSandbox;

  /**
   * Logger sandbox that captures all log entries emitted during the test.
   *
   * Use `logs.captured`, `logs.last()`, and `logs.findByMessage()` to assert
   * on log output. Restored automatically by `restore()`.
   */
  logs: LoggerSandbox;

  /**
   * Resets all engine state without restoring Sinon stubs.
   *
   * Clears:
   * - All registered tasks and decision rules
   * - All registered event handlers
   * - Result recorder state (custom writers, persistence flag)
   * - Register name counters (keeps auto-generated names deterministic)
   *
   * Call this in `beforeEach` to isolate test state without recreating the
   * sandbox on every test.
   */
  reset(): void;

  /**
   * Restores all Sinon stubs and spies, then calls `reset()`.
   *
   * Call this in `afterEach`. Always resets even if `restore()` throws —
   * uses a `try/finally` internally.
   */
  restore(): void;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates the standard engine test sandbox.
 *
 * Create the sandbox once per `describe` block — not per test. Use `reset()`
 * in `beforeEach` and `restore()` in `afterEach`.
 *
 * When combined with {@link makeCoreManagersSandbox} from
 * `@just-in/core/testing`, always restore the core sandbox **before** the
 * engine sandbox to avoid sinon "already restored" errors on shared singletons.
 *
 * @example
 * ```ts
 * const engineSandbox = makeEngineSandbox();
 *
 * beforeEach(() => { engineSandbox.reset(); });
 * afterEach(() => { engineSandbox.restore(); });
 *
 * it('stubs a module function', () => {
 *   engineSandbox.sb.stub(ResultRecorder, 'handleTaskResult').resolves();
 *   // ...
 * });
 *
 * it('asserts on a log entry', () => {
 *   const [entry] = engineSandbox.logs.findByMessage('Task registered');
 *   expect(entry).toBeDefined();
 * });
 * ```
 *
 * Combined with core sandbox:
 * ```ts
 * const engineSandbox = makeEngineSandbox();
 * let coreSandbox: CoreManagersSandbox;
 *
 * beforeEach(() => {
 *   engineSandbox.reset();
 *   coreSandbox = makeCoreManagersSandbox();
 * });
 *
 * afterEach(() => {
 *   coreSandbox.restore(); // ← core first
 *   engineSandbox.restore();
 * });
 * ```
 */
function makeEngineSandbox(): EngineSandbox {
  const sb = sinon.createSandbox();
  const logs = makeLoggerSandbox({ ctx: { package: '@just-in/engine' } });

  function reset(): void {
    try { EventHandlerManager.getInstance().clearEventHandlers(); } catch {}
    try { _clearRegisteredTasks(); } catch {}
    try { _clearRegisteredDecisionRules(); } catch {}
    try { __resetResultRecorderForTests(); } catch {}
    try { resetRegisterCounters(); } catch {}
  }

  function restore(): void {
    try {
      sb.restore();
      logs.restore();
    } finally {
      reset();
    }
  }

  return { sb, logs, reset, restore };
}

export { makeEngineSandbox };
export type { EngineSandbox };
