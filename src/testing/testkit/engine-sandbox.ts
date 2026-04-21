import sinon from 'sinon';
import type { SinonSandbox } from 'sinon';
import { makeLoggerSandbox } from '@just-in/core/testing';
import type { LoggerSandbox } from '@just-in/core/testing';
import { EventHandlerManager } from '../../event/manager';
import { _clearRegisteredTasks, _clearRegisteredDecisionRules, __resetResultRecorderForTests } from '../../handlers';
import { resetRegisterCounters } from '../helpers/register';

/**
 * The engine test sandbox returned by {@link makeEngineSandbox}.
 *
 * Provides a Sinon sandbox for stub/spy creation and a logger sandbox that
 * captures all log entries emitted during the test. Console output is
 * suppressed for the duration of the test — all log entries are redirected
 * to `logs.captured` instead of the real console emitter.
 *
 * **Usage pattern — create per test, not per suite:**
 *
 * ```ts
 * let engineSandbox: EngineSandbox;
 *
 * beforeEach(() => { engineSandbox = makeEngineSandbox(); });
 * afterEach(() => engineSandbox.restore());
 * ```
 *
 * Do not call `makeEngineSandbox()` at the `describe` level — the logger
 * sandbox stubs `GlobalLogger` at creation time and are torn down by
 * `restore()`. If the sandbox is shared across tests, log assertions in
 * subsequent tests will fail because the stubs are no longer active.
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
   * Console output is suppressed — the real emitter is replaced with a spy
   * that writes to `logs.captured`. Use `logs.captured`, `logs.last()`,
   * and `logs.findByMessage()` to assert on log output.
   */
  logs: LoggerSandbox;

  /**
   * Resets all engine registries then restores all Sinon stubs and spies.
   *
   * Engine cleanup runs first so any logging triggered by teardown
   * (e.g. `clearEventHandlers` logs at DEBUG) is still captured by the
   * logger sandbox rather than leaking to the real console emitter.
   *
   * Call this in `afterEach`.
   */
  restore(): void;
};

/**
 * Creates the standard engine test sandbox.
 *
 * **Call this in `beforeEach`, not at the `describe` level.** The logger
 * sandbox stubs `GlobalLogger` at creation time — if the sandbox is shared
 * across tests, log capture stops working after the first `restore()` call.
 *
 * When combined with {@link makeCoreManagersSandbox} from
 * `@just-in/core/testing`, always restore the core sandbox **before** the
 * engine sandbox in `afterEach`:
 *
 * ```ts
 * let engineSandbox: EngineSandbox;
 * let coreSandbox: CoreManagersSandbox;
 *
 * beforeEach(() => {
 *   engineSandbox = makeEngineSandbox();
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

  function restore(): void {
    // Engine cleanup runs first — any logging triggered by teardown
    // (e.g. EventHandlerManager.clearEventHandlers logs at DEBUG) is still
    // captured by the logger sandbox rather than leaking to the console.
    try { EventHandlerManager.getInstance().clearEventHandlers(); } catch {}
    try { _clearRegisteredTasks(); } catch {}
    try { _clearRegisteredDecisionRules(); } catch {}
    try { __resetResultRecorderForTests(); } catch {}
    try { resetRegisterCounters(); } catch {}
    // Sinon stubs and logger sandbox restored last.
    try { sb.restore(); } catch {}
    try { logs.restore(); } catch {}
  }

  return { sb, logs, restore };
}

export { makeEngineSandbox };
export type { EngineSandbox };
