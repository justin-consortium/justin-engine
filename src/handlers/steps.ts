import { createLogger } from '@just-in/core';
import type { StepReturnResult, ExecuteStepReturn } from './types';

const Log = createLogger({
  context: { package: '@just-in/engine', component: 'steps' },
});

/**
 * Executes a single handler step function and returns a timestamped
 * {@link ExecuteStepReturn} envelope.
 *
 * This is the engine's atomic execution unit. Every call to `shouldActivate`,
 * `selectAction`, and `doAction` goes through `executeStep`, which:
 * - Records the wall-clock timestamp at the start of execution.
 * - Validates that the returned status is one of `'success'`, `'stop'`, or
 *   `'error'`.
 * - Catches any thrown error and wraps it in a `{ status: 'error' }` result.
 *
 * **Never throws.** Any error — whether thrown by the step function or caused
 * by an invalid status — is caught and returned as an error envelope. This
 * ensures the engine can always continue processing remaining users and
 * handlers regardless of individual step failures.
 *
 * @typeParam T - The shape of the step result payload.
 *
 * @param step - The step name used in logging and the result envelope
 *   (e.g. `TaskStep.SHOULD_ACTIVATE`, `DecisionRuleStep.SELECT_ACTION`).
 * @param fn   - The async step function to execute. Must return a
 *   {@link StepReturnResult}.
 * @returns A timestamped {@link ExecuteStepReturn} envelope. Never rejects.
 *
 * @example
 * ```ts
 * const result = await executeStep(
 *   TaskStep.SHOULD_ACTIVATE,
 *   async () => task.shouldActivate(user, event),
 * );
 *
 * if (result.result.status !== 'success') return;
 * ```
 */
async function executeStep<T>(
  step: string,
  fn: () => Promise<StepReturnResult<T>>,
): Promise<ExecuteStepReturn<T>> {
  const timestamp = new Date();

  try {
    const result = await fn();

    if (!['success', 'stop', 'error'].includes(result.status)) {
      throw new Error(`Invalid status "${result.status}" returned from step "${step}".`);
    }

    return { step, result, timestamp };
  } catch (error) {
    Log.error('Error in step execution.', { step, error });
    return { step, result: { status: 'error', error }, timestamp };
  }
}

export { executeStep };
