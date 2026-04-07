import { createLogger } from '@just-in/core';
import type { JUser } from '@just-in/core';
import type { JEvent } from '../event';
import type { ExecuteStepReturn, Task, TaskRegistration } from './types';
import { HandlerType, TaskStep } from './types';
import { executeStep } from './steps';
import { handleTaskResult } from './result-recorder';

const Log = createLogger({
  context: { package: '@just-in/engine', component: 'task-manager' },
});

const _tasks: Map<string, Task> = new Map();

/**
 * Registers a Task by name, stamping its `type` as `TASK`.
 *
 * Overwrites any existing registration under the same name — re-registering
 * a task is safe and intentional for hot-reload scenarios.
 *
 * Called via `JustIn.registerTask(task)` or
 * `JustInServerless.registerTask(task)` — do not call this directly in
 * application code.
 *
 * @param task - The task definition. See {@link TaskRegistration}.
 */
function registerTask(task: TaskRegistration): void {
  _tasks.set(task.name, { ...task, type: HandlerType.TASK });
  Log.info('Task registered.', { taskName: task.name });
}

/**
 * Returns a registered Task by name, or `undefined` if not found.
 *
 * Used internally by the executor to resolve handler names from an event's
 * handler array.
 *
 * @param name - The registered task name.
 */
function getTaskByName(name: string): Task | undefined {
  return _tasks.get(name);
}

/**
 * Executes a Task for a single user and event.
 *
 * Steps:
 * 1. `shouldActivate` — if the result is not `'success'`, the task is skipped
 *    for this user. No result is recorded.
 * 2. `doAction` — executed with the `shouldActivate` result as `previousResult`.
 *
 * Results are forwarded to {@link handleTaskResult} for any run that reached
 * at least one step. If `handleTaskResult` throws, the error is caught and
 * logged — it does not affect the user sweep.
 *
 * Never throws — any error in `shouldActivate` or `doAction` is caught by
 * {@link executeStep}, added to the step results as `{ status: 'error' }`,
 * and recorded.
 *
 * @param task  - The registered {@link Task} to execute.
 * @param event - The triggering event.
 * @param user  - The user being processed.
 */
async function executeTask(task: Task, event: JEvent, user: JUser): Promise<void> {
  const results: ExecuteStepReturn[] = [];

  try {
    const shouldActivateResult = await executeStep(
      TaskStep.SHOULD_ACTIVATE,
      async () => Promise.resolve(task.shouldActivate(user, event)),
    );

    if (shouldActivateResult.result.status !== 'success') {
      Log.debug('Task did not activate.', {
        taskName: task.name,
        userUniqueIdentifier: user.uniqueIdentifier,
        status: shouldActivateResult.result.status,
      });
      return;
    }

    results.push(shouldActivateResult);

    const actionResult = await executeStep(TaskStep.DO_ACTION, async () =>
      Promise.resolve(task.doAction(user, event, shouldActivateResult.result)),
    );
    results.push(actionResult);
  } catch (error) {
    Log.error('Unexpected error executing task.', {
      taskName: task.name,
      userUniqueIdentifier: user.uniqueIdentifier,
      error,
    });
    results.push({
      step: 'unknown',
      result: { status: 'error', error },
      timestamp: new Date(),
    });
  } finally {
    if (results.length > 0) {
      try {
        await handleTaskResult({ event, name: task.name, steps: results, user });
      } catch (error) {
        Log.error('Error in handleTaskResult.', {
          taskName: task.name,
          userUniqueIdentifier: user.uniqueIdentifier,
          error,
        });
      }
    }
  }
}

/**
 * Clears all registered tasks.
 *
 * @internal — exported for use in `@just-in/engine/testing` only.
 */
function _clearRegisteredTasks(): void {
  _tasks.clear();
}

export { registerTask, getTaskByName, executeTask, _clearRegisteredTasks };
