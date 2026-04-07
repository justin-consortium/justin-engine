import { createLogger } from '@just-in/core';
import type { JUser } from '@just-in/core';
import type { JEvent } from '../event/types';
import type { DecisionRule, DecisionRuleRegistration, ExecuteStepReturn } from './types';
import { DecisionRuleStep, HandlerType } from './types';
import { executeStep } from './steps';
import { handleDecisionRuleResult } from './result-recorder';

const Log = createLogger({
  context: { package: '@just-in/engine', component: 'decision-rule-manager' },
});

const _decisionRules: Map<string, DecisionRule> = new Map();

/**
 * Registers a Decision Rule by name, stamping its `type` as `DECISION_RULE`.
 *
 * Overwrites any existing registration under the same name.
 *
 * Called via `JustIn.registerDecisionRule(rule)` or
 * `JustInServerless.registerDecisionRule(rule)` — do not call this directly
 * in application code.
 *
 * @param rule - The decision rule definition. See {@link DecisionRuleRegistration}.
 */
function registerDecisionRule(rule: DecisionRuleRegistration): void {
  _decisionRules.set(rule.name, { ...rule, type: HandlerType.DECISION_RULE });
  Log.info('Decision rule registered.', { ruleName: rule.name });
}

/**
 * Returns a registered Decision Rule by name, or `undefined` if not found.
 *
 * Used internally by the executor to resolve handler names from an event's
 * handler array.
 *
 * @param name - The registered rule name.
 */
function getDecisionRuleByName(name: string): DecisionRule | undefined {
  return _decisionRules.get(name);
}

/**
 * Executes a Decision Rule for a single user and event.
 *
 * Steps:
 * 1. `shouldActivate` — if the result is not `'success'`, execution stops.
 *    No result is recorded.
 * 2. `selectAction` — always runs when activated. Determines which action to
 *    take. A `'stop'` result skips `doAction` but the run is still recorded.
 * 3. `doAction` — runs only when `selectAction` returns `'success'`.
 *
 * Results are forwarded to {@link handleDecisionRuleResult} for any run that
 * reached at least one step after activation. If `handleDecisionRuleResult`
 * throws, the error is caught and logged.
 *
 * Never throws — any error in any step is caught by {@link executeStep},
 * wrapped as `{ status: 'error' }`, and included in the recorded result.
 *
 * @param rule  - The registered {@link DecisionRule} to execute.
 * @param event - The triggering event.
 * @param user  - The user being processed.
 */
async function executeDecisionRule(
  rule: DecisionRule,
  event: JEvent,
  user: JUser,
): Promise<void> {
  const results: ExecuteStepReturn[] = [];

  try {
    const shouldActivateResult = await executeStep(
      DecisionRuleStep.SHOULD_ACTIVATE,
      async () => Promise.resolve(rule.shouldActivate(user, event)),
    );

    if (shouldActivateResult.result.status !== 'success') {
      Log.debug('Decision rule did not activate.', {
        ruleName: rule.name,
        userUniqueIdentifier: user.uniqueIdentifier,
        status: shouldActivateResult.result.status,
      });
      return;
    }

    results.push(shouldActivateResult);

    const selectActionResult = await executeStep(
      DecisionRuleStep.SELECT_ACTION,
      async () =>
        Promise.resolve(rule.selectAction(user, event, shouldActivateResult.result)),
    );
    results.push(selectActionResult);

    if (selectActionResult.result.status === 'success') {
      const actionResult = await executeStep(
        DecisionRuleStep.DO_ACTION,
        async () =>
          Promise.resolve(rule.doAction(user, event, selectActionResult.result)),
      );
      results.push(actionResult);
    }
  } catch (error) {
    Log.error('Unexpected error executing decision rule.', {
      ruleName: rule.name,
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
        await handleDecisionRuleResult({ event, name: rule.name, steps: results, user });
      } catch (error) {
        Log.error('Error in handleDecisionRuleResult.', {
          ruleName: rule.name,
          userUniqueIdentifier: user.uniqueIdentifier,
          error,
        });
      }
    }
  }
}

/**
 * Clears all registered decision rules.
 *
 * @internal — exported for use in `@just-in/engine/testing` only.
 */
function _clearRegisteredDecisionRules(): void {
  _decisionRules.clear();
}

export {
  registerDecisionRule,
  getDecisionRuleByName,
  executeDecisionRule,
  _clearRegisteredDecisionRules,
};
