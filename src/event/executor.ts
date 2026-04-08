import { createLogger } from '@just-in/core';
import type { JUser } from '@just-in/core';
import type { JEvent } from './types';
import { EventHandlerManager } from './manager';
import { getTaskByName, executeTask,  getDecisionRuleByName, executeDecisionRule } from '../handlers';

const Log = createLogger({
  context: { package: '@just-in/engine', component: 'executor' },
});

/**
 * Executes all handlers registered for an event against a set of users.
 *
 * This is the engine's core execution loop. For each handler in registration
 * order:
 *
 * 1. `beforeExecution` is called once — before any user runs for this handler.
 * 2. The handler runs for every user in sequence.
 * 3. `afterExecution` is called once — after all users have run for this handler.
 *
 * The next handler does not start until the current handler has completed its
 * full user sweep including `afterExecution`. This ordering guarantee is what
 * allows Tasks that write data onto `user.attributes` to make that data
 * available to subsequent Decision Rules in the same pipeline run.
 *
 * **Error isolation:** lifecycle errors (`beforeExecution`, `afterExecution`)
 * are caught and logged but do not abort the sweep. Per-user execution errors
 * are also caught and logged — one user failing does not prevent other users
 * from being processed.
 *
 * **Multi-process note:** if multiple processes run `JustInEngine` against the
 * same database, each will pick up events from the change stream and call this
 * function independently. The current implementation has no claim/lock
 * mechanism, so events would be processed once per process. Claim semantics
 * (e.g. `findOneAndUpdate` with a status field) would be needed for safe
 * multi-process deployments. The change listener wiring is already in place
 * to support that upgrade.
 *
 * @param event          - The event being processed.
 * @param users          - The users to run each handler against.
 * @param handlerManager - The registry to look up handler names from.
 */
async function executeEventForUsers(
  event: JEvent,
  users: JUser[],
  handlerManager: EventHandlerManager,
): Promise<void> {
  const handlerNames = handlerManager.getHandlersForEventType(event.eventType);

  if (!handlerNames.length) {
    Log.warn('No handlers registered for event type.', { eventType: event.eventType });
    return;
  }

  for (const handlerName of handlerNames) {
    const task = getTaskByName(handlerName);
    const rule = getDecisionRuleByName(handlerName);

    if (!task && !rule) {
      Log.warn('Handler not found in registry; skipping.', { handlerName, eventType: event.eventType });
      continue;
    }

    const handler = task ?? rule!;

    if (handler.beforeExecution) {
      try {
        await handler.beforeExecution(event);
      } catch (error) {
        Log.error('beforeExecution failed.', { handlerName, eventType: event.eventType, error });
      }
    }

    for (const user of users) {
      try {
        if (task) {
          await executeTask(task, event, user);
        } else {
          await executeDecisionRule(rule!, event, user);
        }
      } catch (error) {
        Log.error('Execution error for handler on user.', {
          handlerName,
          userUniqueIdentifier: user.uniqueIdentifier,
          eventType: event.eventType,
          error,
        });
      }
    }

    if (handler.afterExecution) {
      try {
        await handler.afterExecution(event);
      } catch (error) {
        Log.error('afterExecution failed.', { handlerName, eventType: event.eventType, error });
      }
    }
  }
}

export { executeEventForUsers };
