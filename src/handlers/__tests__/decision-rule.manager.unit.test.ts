import sinon from 'sinon';
import { makeEngineSandbox, makeEvent, makeEngineTestUser } from '../../testing';
import {
  registerDecisionRule,
  getDecisionRuleByName,
  executeDecisionRule,
  _clearRegisteredDecisionRules,
} from '../decision-rule.manager';
import * as Steps from '../steps';
import * as ResultRecorder from '../result-recorder';
import { HandlerType, DecisionRuleStep } from '../types';
import type { DecisionRule, DecisionRuleRegistration } from '../types';

describe('handlers/decision-rule-manager', () => {
  const engineSandbox = makeEngineSandbox();
  let executeStepStub: sinon.SinonStub;
  let handleDecisionRuleResultStub: sinon.SinonStub;

  beforeEach(() => {
    engineSandbox.reset();
    executeStepStub = engineSandbox.sb.stub(Steps, 'executeStep');
    handleDecisionRuleResultStub = engineSandbox.sb
      .stub(ResultRecorder, 'handleDecisionRuleResult')
      .resolves();
  });

  afterEach(() => {
    engineSandbox.restore();
  });

  function makeRule(overrides: Partial<DecisionRule> = {}): DecisionRule {
    return {
      name: 'testRule',
      type: HandlerType.DECISION_RULE,
      shouldActivate: async () => ({ status: 'success' }),
      selectAction: async () => ({ status: 'success' }),
      doAction: async () => ({ status: 'success' }),
      ...overrides,
    };
  }

  describe('registerDecisionRule', () => {
    it('registers a rule retrievable by name', () => {
      const reg: DecisionRuleRegistration = {
        name: 'myRule',
        shouldActivate: async () => ({ status: 'success' }),
        selectAction: async () => ({ status: 'success' }),
        doAction: async () => ({ status: 'success' }),
      };

      registerDecisionRule(reg);

      expect(getDecisionRuleByName('myRule')?.name).toBe('myRule');
    });

    it('stamps type as DECISION_RULE', () => {
      registerDecisionRule({
        name: 'typed',
        shouldActivate: async () => ({ status: 'success' }),
        selectAction: async () => ({ status: 'success' }),
        doAction: async () => ({ status: 'success' }),
      });

      expect(getDecisionRuleByName('typed')?.type).toBe(HandlerType.DECISION_RULE);
    });

    it('overwrites a previous registration under the same name', () => {
      const v1: DecisionRuleRegistration = {
        name: 'dup',
        shouldActivate: async () => ({ status: 'stop' }),
        selectAction: async () => ({ status: 'success' }),
        doAction: async () => ({ status: 'success' }),
      };
      const v2: DecisionRuleRegistration = {
        name: 'dup',
        shouldActivate: async () => ({ status: 'success' }),
        selectAction: async () => ({ status: 'success' }),
        doAction: async () => ({ status: 'success' }),
      };

      registerDecisionRule(v1);
      registerDecisionRule(v2);

      expect(getDecisionRuleByName('dup')!.shouldActivate).toBe(v2.shouldActivate);
    });
  });

  describe('getDecisionRuleByName', () => {
    it('returns undefined for an unregistered name', () => {
      expect(getDecisionRuleByName('ghost')).toBeUndefined();
    });
  });

  describe('executeDecisionRule', () => {
    const user = makeEngineTestUser({ id: 'u1', uniqueIdentifier: 'alice' });
    const event = makeEvent({ eventType: 'TEST_EVENT' });

    it('runs all three steps when shouldActivate and selectAction both succeed', async () => {
      executeStepStub
        .onCall(0).resolves({ step: DecisionRuleStep.SHOULD_ACTIVATE, result: { status: 'success' }, timestamp: new Date() })
        .onCall(1).resolves({ step: DecisionRuleStep.SELECT_ACTION, result: { status: 'success' }, timestamp: new Date() })
        .onCall(2).resolves({ step: DecisionRuleStep.DO_ACTION, result: { status: 'success' }, timestamp: new Date() });

      await executeDecisionRule(makeRule(), event, user);

      expect(executeStepStub.callCount).toBe(3);
      expect(handleDecisionRuleResultStub.calledOnce).toBe(true);

      const { steps } = handleDecisionRuleResultStub.firstCall.args[0];
      expect(steps).toHaveLength(3);
      expect(steps[0].step).toBe(DecisionRuleStep.SHOULD_ACTIVATE);
      expect(steps[1].step).toBe(DecisionRuleStep.SELECT_ACTION);
      expect(steps[2].step).toBe(DecisionRuleStep.DO_ACTION);
    });

    it('runs shouldActivate and selectAction but skips doAction when selectAction is not success', async () => {
      executeStepStub
        .onCall(0).resolves({ step: DecisionRuleStep.SHOULD_ACTIVATE, result: { status: 'success' }, timestamp: new Date() })
        .onCall(1).resolves({ step: DecisionRuleStep.SELECT_ACTION, result: { status: 'stop' }, timestamp: new Date() });

      await executeDecisionRule(makeRule(), event, user);

      expect(executeStepStub.callCount).toBe(2);
      expect(handleDecisionRuleResultStub.calledOnce).toBe(true);

      const { steps } = handleDecisionRuleResultStub.firstCall.args[0];
      expect(steps).toHaveLength(2);
    });

    it('skips all steps and does not record when shouldActivate is not success', async () => {
      executeStepStub.onCall(0).resolves({
        step: DecisionRuleStep.SHOULD_ACTIVATE,
        result: { status: 'stop' },
        timestamp: new Date(),
      });

      await executeDecisionRule(makeRule(), event, user);

      expect(executeStepStub.callCount).toBe(1);
      expect(handleDecisionRuleResultStub.called).toBe(false);
    });

    it('skips all steps and does not record when shouldActivate returns error', async () => {
      executeStepStub.onCall(0).resolves({
        step: DecisionRuleStep.SHOULD_ACTIVATE,
        result: { status: 'error', error: new Error('check failed') },
        timestamp: new Date(),
      });

      await executeDecisionRule(makeRule(), event, user);

      expect(executeStepStub.callCount).toBe(1);
      expect(handleDecisionRuleResultStub.called).toBe(false);
    });

    it('passes shouldActivate result to selectAction as previousResult', async () => {
      const shouldActivateResult = {
        status: 'success' as const,
        result: { decisionPointType: 'morning' },
      };

      executeStepStub
        .onCall(0).resolves({ step: DecisionRuleStep.SHOULD_ACTIVATE, result: shouldActivateResult, timestamp: new Date() })
        .onCall(1).resolves({ step: DecisionRuleStep.SELECT_ACTION, result: { status: 'success' }, timestamp: new Date() })
        .onCall(2).resolves({ step: DecisionRuleStep.DO_ACTION, result: { status: 'success' }, timestamp: new Date() });

      const rule = makeRule();
      const selectActionSpy = sinon.spy(rule, 'selectAction');

      executeStepStub.onCall(1).callsFake(
        async (_step: string, fn: () => Promise<unknown>) => {
          await fn();
          return { step: DecisionRuleStep.SELECT_ACTION, result: { status: 'success' }, timestamp: new Date() };
        },
      );

      await executeDecisionRule(rule, event, user);

      expect(selectActionSpy.firstCall.args[2]).toEqual(shouldActivateResult);
    });

    it('passes selectAction result to doAction as previousResult', async () => {
      const selectActionResult = {
        status: 'success' as const,
        result: { action: 'SEND_MESSAGE', messageId: 'msg-1' },
      };

      executeStepStub
        .onCall(0).resolves({ step: DecisionRuleStep.SHOULD_ACTIVATE, result: { status: 'success' }, timestamp: new Date() })
        .onCall(1).resolves({ step: DecisionRuleStep.SELECT_ACTION, result: selectActionResult, timestamp: new Date() })
        .onCall(2).resolves({ step: DecisionRuleStep.DO_ACTION, result: { status: 'success' }, timestamp: new Date() });

      const rule = makeRule();
      const doActionSpy = sinon.spy(rule, 'doAction');

      executeStepStub.onCall(2).callsFake(
        async (_step: string, fn: () => Promise<unknown>) => {
          await fn();
          return { step: DecisionRuleStep.DO_ACTION, result: { status: 'success' }, timestamp: new Date() };
        },
      );

      await executeDecisionRule(rule, event, user);

      expect(doActionSpy.firstCall.args[2]).toEqual(selectActionResult);
    });

    it('records an unknown error step when executeStep throws unexpectedly', async () => {
      executeStepStub.rejects(new Error('unexpected'));

      await executeDecisionRule(makeRule(), event, user);

      expect(handleDecisionRuleResultStub.calledOnce).toBe(true);
      const { steps } = handleDecisionRuleResultStub.firstCall.args[0];
      expect(steps).toHaveLength(1);
      expect(steps[0].step).toBe('unknown');
      expect(steps[0].result.status).toBe('error');
    });

    it('includes event, name, and user in the recorded result', async () => {
      executeStepStub
        .onCall(0).resolves({ step: DecisionRuleStep.SHOULD_ACTIVATE, result: { status: 'success' }, timestamp: new Date() })
        .onCall(1).resolves({ step: DecisionRuleStep.SELECT_ACTION, result: { status: 'success' }, timestamp: new Date() })
        .onCall(2).resolves({ step: DecisionRuleStep.DO_ACTION, result: { status: 'success' }, timestamp: new Date() });

      const rule = makeRule({ name: 'namedRule' });
      await executeDecisionRule(rule, event, user);

      const payload = handleDecisionRuleResultStub.firstCall.args[0];
      expect(payload.name).toBe('namedRule');
      expect(payload.event).toBe(event);
      expect(payload.user).toBe(user);
    });

    it('does not throw when handleDecisionRuleResult throws', async () => {
      executeStepStub
        .onCall(0).resolves({ step: DecisionRuleStep.SHOULD_ACTIVATE, result: { status: 'success' }, timestamp: new Date() })
        .onCall(1).resolves({ step: DecisionRuleStep.SELECT_ACTION, result: { status: 'success' }, timestamp: new Date() })
        .onCall(2).resolves({ step: DecisionRuleStep.DO_ACTION, result: { status: 'success' }, timestamp: new Date() });
      handleDecisionRuleResultStub.rejects(new Error('recorder broke'));

      await expect(executeDecisionRule(makeRule(), event, user)).resolves.toBeUndefined();
    });

    it('logs an error when handleDecisionRuleResult throws', async () => {
      executeStepStub
        .onCall(0).resolves({ step: DecisionRuleStep.SHOULD_ACTIVATE, result: { status: 'success' }, timestamp: new Date() })
        .onCall(1).resolves({ step: DecisionRuleStep.SELECT_ACTION, result: { status: 'success' }, timestamp: new Date() })
        .onCall(2).resolves({ step: DecisionRuleStep.DO_ACTION, result: { status: 'success' }, timestamp: new Date() });
      handleDecisionRuleResultStub.rejects(new Error('recorder broke'));

      await executeDecisionRule(makeRule(), event, user);

      const errorLogs = engineSandbox.logs.findByMessage('Error in handleDecisionRuleResult');
      expect(errorLogs).toHaveLength(1);
      expect(errorLogs[0].entry.severity).toBe('ERROR');
    });
  });

  describe('_clearRegisteredDecisionRules', () => {
    it('removes all registered rules', () => {
      registerDecisionRule({
        name: 'toRemove',
        shouldActivate: async () => ({ status: 'success' }),
        selectAction: async () => ({ status: 'success' }),
        doAction: async () => ({ status: 'success' }),
      });

      _clearRegisteredDecisionRules();

      expect(getDecisionRuleByName('toRemove')).toBeUndefined();
    });
  });
});
