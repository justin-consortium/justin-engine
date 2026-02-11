import sinon from 'sinon';

import type {
  DecisionRuleRegistration,
  StepReturnResult,
  TaskRegistration,
} from '../../handlers/handler.type';
import { registerDecisionRule } from '../../handlers/decision-rule.manager';
import { registerTask } from '../../handlers/task.manager';

let taskN = 0;
let ruleN = 0;

const defaultShouldActivate = (): StepReturnResult<boolean> => ({
  status: 'success',
  result: true,
});

const defaultDoAction = (): StepReturnResult<null> => ({
  status: 'success',
  result: null,
});

const defaultSelectAction = (): StepReturnResult<{ action: 'noop' }> => ({
  status: 'success',
  result: { action: 'noop' },
});

/**
 * Resets internal counters used for auto-generated test handler names.
 * Call this from your test sandbox reset to keep tests deterministic.
 */
function resetRegisterCounters(): void {
  taskN = 0;
  ruleN = 0;
}

type RegisteredTestTask = TaskRegistration & {
  shouldActivateSpy: sinon.SinonSpy;
  doActionSpy: sinon.SinonSpy;
};

type RegisteredTestDecisionRule = DecisionRuleRegistration & {
  shouldActivateSpy: sinon.SinonSpy;
  selectActionSpy: sinon.SinonSpy;
  doActionSpy: sinon.SinonSpy;
};

/**
 * Creates and registers a TaskRegistration with deterministic defaults.
 *
 * - No assertions (tests own their assertions).
 * - Provides default step fns if caller doesn't supply them.
 */
function registerTestTask(
  overrides: Partial<TaskRegistration> = {},
): RegisteredTestTask {
  const name = overrides.name ?? `task_test_${++taskN}`;

  const shouldActivateImpl =
    overrides.shouldActivate ?? (defaultShouldActivate as TaskRegistration['shouldActivate']);
  const doActionImpl =
    overrides.doAction ?? (defaultDoAction as TaskRegistration['doAction']);

  const shouldActivateSpy = sinon.spy(shouldActivateImpl);
  const doActionSpy = sinon.spy(doActionImpl);

  const task: TaskRegistration = {
    name,
    beforeExecution: overrides.beforeExecution,
    afterExecution: overrides.afterExecution,
    shouldActivate: shouldActivateSpy as unknown as TaskRegistration['shouldActivate'],
    doAction: doActionSpy as unknown as TaskRegistration['doAction'],
  };

  registerTask(task);

  return { ...task, shouldActivateSpy, doActionSpy };
}

/**
 * Creates and registers a DecisionRuleRegistration with deterministic defaults.
 *
 * - No assertions (tests own their assertions).
 * - Provides default step fns if caller doesn't supply them.
 */
function registerTestDecisionRule(
  overrides: Partial<DecisionRuleRegistration> = {},
): RegisteredTestDecisionRule {
  const name = overrides.name ?? `rule_test_${++ruleN}`;

  const shouldActivateImpl =
    overrides.shouldActivate ??
    (defaultShouldActivate as DecisionRuleRegistration['shouldActivate']);
  const selectActionImpl =
    overrides.selectAction ??
    (defaultSelectAction as DecisionRuleRegistration['selectAction']);
  const doActionImpl =
    overrides.doAction ?? (defaultDoAction as DecisionRuleRegistration['doAction']);

  const shouldActivateSpy = sinon.spy(shouldActivateImpl);
  const selectActionSpy = sinon.spy(selectActionImpl);
  const doActionSpy = sinon.spy(doActionImpl);

  const rule: DecisionRuleRegistration = {
    name,
    beforeExecution: overrides.beforeExecution,
    afterExecution: overrides.afterExecution,
    shouldActivate:
      shouldActivateSpy as unknown as DecisionRuleRegistration['shouldActivate'],
    selectAction:
      selectActionSpy as unknown as DecisionRuleRegistration['selectAction'],
    doAction: doActionSpy as unknown as DecisionRuleRegistration['doAction'],
  };

  registerDecisionRule(rule);

  return { ...rule, shouldActivateSpy, selectActionSpy, doActionSpy };
}

export {
  registerTestDecisionRule,
  registerTestTask,
  resetRegisterCounters,
};

export type { RegisteredTestDecisionRule, RegisteredTestTask };
