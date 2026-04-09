import { _resetEngine } from '../../engine';
import { EventHandlerManager } from '../../event';
import { _clearRegisteredTasks, _clearRegisteredDecisionRules, __resetResultRecorderForTests } from '../../handlers';
import { resetRegisterCounters } from './register';

/**
 * Resets all engine in-memory registries to a clean state.
 *
 * Clears:
 * - Engine module state (`_isInitialized`, interval timers)
 * - All registered event handlers
 * - All registered tasks and decision rules
 * - Result recorder state
 * - Register name counters
 *
 * Safe to call multiple times. Each step is wrapped independently so a
 * single failure does not prevent the rest from running.
 *
 * Called automatically by {@link makeEngineSandbox} `reset()` and
 * `restore()`. Only call this directly if you are not using the sandbox.
 */
function resetEngineState(): void {
  try { _resetEngine(); } catch {}
  try { EventHandlerManager.getInstance().clearEventHandlers(); } catch {}
  try { _clearRegisteredTasks(); } catch {}
  try { _clearRegisteredDecisionRules(); } catch {}
  try { __resetResultRecorderForTests(); } catch {}
  try { resetRegisterCounters(); } catch {}
}

export { resetEngineState };
