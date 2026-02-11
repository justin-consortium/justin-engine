import { EventHandlerManager } from '../../event/event-handler-manager';
import { JustInLiteWrapper } from '../../JustInLite';
import { JustInWrapper } from '../../JustInWrapper';
import { _clearRegisteredDecisionRules } from '../../handlers/decision-rule.manager';
import { _clearRegisteredTasks } from '../../handlers/task.manager';

const clearRegisteredTasks = _clearRegisteredTasks;
const clearRegisteredDecisionRules = _clearRegisteredDecisionRules;

/**
 * Resets engine singletons and in-memory registries to avoid test leakage.
 * Safe to call multiple times.
 */
async function reset(): Promise<void> {
  // Singletons
  try {
    await JustInLiteWrapper.killInstance();
  } catch {}

  try {
    await JustInWrapper.killInstance?.();
  } catch {}

  // Event handler registry
  try {
    EventHandlerManager.getInstance().clearEventHandlers();
  } catch {}

  // Task / decision rule registries
  try {
    clearRegisteredTasks();
  } catch {}

  try {
    clearRegisteredDecisionRules();
  } catch {}
}

export { reset, clearRegisteredTasks, clearRegisteredDecisionRules };
