import sinon from 'sinon';
import type {
  DecisionRuleRegistration,
  StepReturnResult,
  TaskRegistration,
} from '../../handlers/types';
import { registerDecisionRule, registerTask } from '../../handlers';

// ---------------------------------------------------------------------------
// Auto-increment counters for generated names
// ---------------------------------------------------------------------------

let _taskN = 0;
let _ruleN = 0;

/**
 * Resets the auto-increment counters used for generated test handler names.
 *
 * Call this from your sandbox `reset()` so generated names stay deterministic
 * across test runs. {@link makeEngineSandbox} calls this automatically.
 */
function resetRegisterCounters(): void {
  _taskN = 0;
  _ruleN = 0;
}

// ---------------------------------------------------------------------------
// Default step implementations
// ---------------------------------------------------------------------------

const _defaultShouldActivate = (): StepReturnResult => ({
  status: 'success',
  result: {},
});

const _defaultDoAction = (): StepReturnResult => ({
  status: 'success',
  result: {},
});

const _defaultSelectAction = (): StepReturnResult => ({
  status: 'success',
  result: { action: 'noop' },
});

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

/**
 * A registered test task with its spy-wrapped step functions exposed for
 * assertion.
 */
type RegisteredTestTask = TaskRegistration & {
  /** Spy-wrapped `shouldActivate`. Assert `.callCount`, `.args`, etc. */
  shouldActivateSpy: sinon.SinonSpy;
  /** Spy-wrapped `doAction`. Assert `.callCount`, `.args`, etc. */
  doActionSpy: sinon.SinonSpy;
};

/**
 * A registered test decision rule with its spy-wrapped step functions exposed
 * for assertion.
 */
type RegisteredTestDecisionRule = DecisionRuleRegistration & {
  /** Spy-wrapped `shouldActivate`. */
  shouldActivateSpy: sinon.SinonSpy;
  /** Spy-wrapped `selectAction`. */
  selectActionSpy: sinon.SinonSpy;
  /** Spy-wrapped `doAction`. */
  doActionSpy: sinon.SinonSpy;
};

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/**
 * Creates and registers a {@link TaskRegistration} with spy-wrapped step
 * functions and deterministic defaults.
 *
 * All step functions default to returning `{ status: 'success' }`. Override
 * any step by passing it in `overrides`. The returned spies can be used to
 * assert call counts and arguments without bundling assertions inside the
 * factory itself.
 *
 * Names are auto-generated as `task_test_1`, `task_test_2`, etc. unless
 * overridden. Call {@link resetRegisterCounters} (done automatically by
 * {@link makeEngineSandbox}) to keep names deterministic across tests.
 *
 * @param overrides - Optional partial task registration to customise defaults.
 * @returns The registered task with spy references attached.
 *
 * @example
 * ```ts
 * const task = registerTestTask({
 *   name: 'myTask',
 *   shouldActivate: async () => ({ status: 'stop' }),
 * });
 *
 * // After running the pipeline:
 * expect(task.shouldActivateSpy.callCount).toBe(3); // ran for 3 users
 * expect(task.doActionSpy.callCount).toBe(0);        // never reached
 * ```
 */
function registerTestTask(
  overrides: Partial<TaskRegistration> = {},
): RegisteredTestTask {
  const name = overrides.name ?? `task_test_${++_taskN}`;

  const shouldActivateImpl =
    overrides.shouldActivate ?? (_defaultShouldActivate as TaskRegistration['shouldActivate']);
  const doActionImpl =
    overrides.doAction ?? (_defaultDoAction as TaskRegistration['doAction']);

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
 * Creates and registers a {@link DecisionRuleRegistration} with spy-wrapped
 * step functions and deterministic defaults.
 *
 * All step functions default to returning `{ status: 'success' }`. Override
 * any step by passing it in `overrides`.
 *
 * Names are auto-generated as `rule_test_1`, `rule_test_2`, etc. unless
 * overridden.
 *
 * @param overrides - Optional partial decision rule registration to customise
 *   defaults.
 * @returns The registered rule with spy references attached.
 *
 * @example
 * ```ts
 * const rule = registerTestDecisionRule({
 *   selectAction: async (_user, _event, prev) => ({
 *     status: 'success',
 *     result: { action: 'SEND_MESSAGE', messageId: 'msg-1' },
 *   }),
 * });
 *
 * // After running the pipeline:
 * expect(rule.selectActionSpy.callCount).toBe(2);
 * const selectedAction = rule.selectActionSpy.firstCall.returnValue;
 * ```
 */
function registerTestDecisionRule(
  overrides: Partial<DecisionRuleRegistration> = {},
): RegisteredTestDecisionRule {
  const name = overrides.name ?? `rule_test_${++_ruleN}`;

  const shouldActivateImpl =
    overrides.shouldActivate ??
    (_defaultShouldActivate as DecisionRuleRegistration['shouldActivate']);
  const selectActionImpl =
    overrides.selectAction ??
    (_defaultSelectAction as DecisionRuleRegistration['selectAction']);
  const doActionImpl =
    overrides.doAction ?? (_defaultDoAction as DecisionRuleRegistration['doAction']);

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
  registerTestTask,
  registerTestDecisionRule,
  resetRegisterCounters,
};

export type { RegisteredTestTask, RegisteredTestDecisionRule };
