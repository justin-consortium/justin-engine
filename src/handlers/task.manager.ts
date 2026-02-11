import { createLogger } from '@just-in/core';
import type { JUser } from '@just-in/core';
import {
  ExecuteStepReturn,
  HandlerType,
  Task,
  TaskRegistration,
  TaskStep,
} from './handler.type';
import { executeStep } from './steps.helpers';
import { JEvent } from '../event/event.type';
import { handleTaskResult } from './result-recorder';

const Log = createLogger({
  context: {
    component: 'TaskManager',
  },
});

const tasks: Map<string, Task> = new Map();

/**
 * Registers a Task by its name, setting its type to `TASK` in the process.
 * @param {TaskRegistration} task - The task to register, with the `type` set to `TASK`.
 */
export const registerTask = (task: TaskRegistration): void => {
  tasks.set(task.name, { ...task, type: HandlerType.TASK });
  Log.info('Task registered successfully.', { taskName: task.name });
};

/**
 * Retrieves a Task by its name.
 * @param {string} name - The name of the Task to retrieve.
 * @returns {Task | undefined} - The Task if found, or undefined otherwise.
 */
export const getTaskByName = (name: string): Task | undefined => {
  return tasks.get(name);
};

/**
 * Executes a Task for a specific user and event.
 *
 * @param task - The Task to execute.
 * @param event - The triggering event.
 * @param user - The user for whom the Task is being executed.
 */
export async function executeTask(
  task: Task,
  event: JEvent,
  user: JUser,
): Promise<void> {
  const results: ExecuteStepReturn<any>[] = [];

  try {
    Log.info('Executing task for user and event.', {
      taskName: task.name,
      user,
      event,
    });

    const shouldActivateResult = await executeStep(
      TaskStep.SHOULD_ACTIVATE,
      async () => Promise.resolve(task.shouldActivate(user, event)),
    );

    if (shouldActivateResult.result.status === 'success') {
      results.push(shouldActivateResult);

      const actionResult = await executeStep(TaskStep.DO_ACTION, async () =>
        Promise.resolve(
          task.doAction(user, event, shouldActivateResult.result),
        ),
      );
      results.push(actionResult);
    } else {
      Log.debug('Task did not activate.', {
        taskName: task.name,
        user,
        event,
        stepResult: shouldActivateResult.result,
      });
      return;
    }
  } catch (error) {
    Log.error('Error executing task for user.', {
      taskName: task.name,
      user,
      event,
      error,
    });
    results.push({
      step: 'unknown',
      result: { status: 'error', error },
      timestamp: new Date(),
    });
  } finally {
    if (results.length > 0) {
      try{
        await handleTaskResult({
          event,
          name: task.name,
          steps: results,
          user,
        });
      } catch(error) {
        Log.error(
          'Error executing task for user.',
          { taskName: task.name, user, event, error, });
        results.push({
          step: 'unknown',
          result: { status: 'error', error, },
          timestamp: new Date(),
        });
      }
    }
    Log.info('Completed execution of task for user.', {
      taskName: task.name,
      user,
      event,
      steps: results,
    });
  }
}

/**
 * Clears all registered tasks (primarily for tests).
 */
export const _clearRegisteredTasks = (): void => {
  tasks.clear();
};
