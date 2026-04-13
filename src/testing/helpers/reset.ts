import { _resetEngine } from '../../engine';
import { EventHandlerManager } from '../../event/manager';
import { _clearRegisteredTasks, _clearRegisteredDecisionRules, __resetResultRecorderForTests } from '../../handlers';
import { resetRegisterCounters } from './register';

/**
 * Resets all engine in-memory registries to a clean state.
 *
 * Clears engine module state, event handlers, tasks, decision rules, result
 * recorder state, and register name counters. Each step is wrapped
 * independently so a single failure does not prevent the rest from running.
 *
 * Only call this directly if you are not using {@link makeEngineSandbox} —
 * the sandbox calls this automatically in `restore()`.
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
