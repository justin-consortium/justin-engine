import sinon from 'sinon';

import { makeEngineSandbox } from '../../testing';
import { makeUser } from '@just-in/core/testing';

import {
  executeDecisionRule,
  getDecisionRuleByName,
  registerDecisionRule,
} from '../decision-rule.manager';

import {
  HandlerType,
  DecisionRuleStep,
  type DecisionRuleRegistration,
  type DecisionRule,
} from '../handler.type';

import * as StepsHelpers from '../steps.helpers';
import * as ResultRecorder from '../result-recorder';

import type { JEvent } from '../../event/event.type';
import type { JUser } from '@just-in/core';

describe('DecisionRuleManager', () => {
  const engineSandbox = makeEngineSandbox();

  let executeStepStub: sinon.SinonStub;
  let handleDecisionRuleResultStub: sinon.SinonStub;

  beforeEach(async () => {
    await engineSandbox.reset();

    executeStepStub = engineSandbox.sb.stub(StepsHelpers, 'executeStep');
    handleDecisionRuleResultStub = engineSandbox.sb.stub(
      ResultRecorder,
      'handleDecisionRuleResult',
    );
  });

  afterEach(async () => {
    await engineSandbox.restore();
  });

  describe('registerDecisionRule', () => {
    it('registers a decision rule that can be retrieved by name', () => {
      const mockRule: DecisionRuleRegistration = {
        name: 'mockRule',
        shouldActivate: async () => ({ status: 'success' } as any),
        selectAction: async () => ({ status: 'success' } as any),
        doAction: async () => ({ status: 'success' } as any),
      };

      registerDecisionRule(mockRule);

      const retrievedRule = getDecisionRuleByName(mockRule.name);
      expect(retrievedRule).toBeDefined();
      expect(retrievedRule!.name).toBe(mockRule.name);
      expect(retrievedRule!.type).toBe(HandlerType.DECISION_RULE);
    });
  });

  describe('getDecisionRuleByName', () => {
    it('returns undefined for a non-existent rule', () => {
      const result = getDecisionRuleByName('nonExistentRule');
      expect(result).toBeUndefined();
    });

    it('retrieves a registered rule', () => {
      const mockRule: DecisionRuleRegistration = {
        name: 'existingRule',
        shouldActivate: async () => ({ status: 'success' } as any),
        selectAction: async () => ({ status: 'success' } as any),
        doAction: async () => ({ status: 'success' } as any),
      };

      registerDecisionRule(mockRule);

      const result = getDecisionRuleByName(mockRule.name);

      expect(result).toBeDefined();
      expect(result!.name).toBe(mockRule.name);
      expect(result!.type).toBe(HandlerType.DECISION_RULE);
    });
  });

  describe('executeDecisionRule', () => {
    const mockRule: DecisionRule = {
      name: 'testRule',
      type: HandlerType.DECISION_RULE,
      shouldActivate: async () => ({ status: 'success' } as any),
      selectAction: async () => ({ status: 'success' } as any),
      doAction: async () => ({ status: 'success' } as any),
    };

    const mockEvent: JEvent = {
      id: 'event123',
      eventType: 'MOCK_EVENT',
      generatedTimestamp: new Date(),
    };

    const mockUser: JUser = makeUser({
      id: 'user123',
      uniqueIdentifier: 'user123',
      attributes: { preferredName: 'Test User' },
    }) as unknown as JUser;

    it('records results when all steps succeed', async () => {
      executeStepStub.onCall(0).resolves({
        step: DecisionRuleStep.SHOULD_ACTIVATE,
        result: { status: 'success' },
      });
      executeStepStub.onCall(1).resolves({
        step: DecisionRuleStep.SELECT_ACTION,
        result: { status: 'success' },
      });
      executeStepStub.onCall(2).resolves({
        step: DecisionRuleStep.DO_ACTION,
        result: { status: 'success' },
      });

      await executeDecisionRule(mockRule, mockEvent, mockUser);

      expect(executeStepStub.callCount).toBe(3);

      expect(handleDecisionRuleResultStub.calledOnce).toBe(true);
      const payload = handleDecisionRuleResultStub.firstCall.args[0];

      expect(payload).toEqual({
        event: mockEvent,
        name: mockRule.name,
        steps: [
          { step: DecisionRuleStep.SHOULD_ACTIVATE, result: { status: 'success' } },
          { step: DecisionRuleStep.SELECT_ACTION, result: { status: 'success' } },
          { step: DecisionRuleStep.DO_ACTION, result: { status: 'success' } },
        ],
        user: mockUser,
      });
    });

    it('skips further steps if shouldActivate is not success and does not record a result payload', async () => {
      executeStepStub.resolves({
        step: DecisionRuleStep.SHOULD_ACTIVATE,
        result: { status: 'failure' },
      });

      await executeDecisionRule(mockRule, mockEvent, mockUser);

      expect(executeStepStub.callCount).toBe(1);
      expect(handleDecisionRuleResultStub.called).toBe(false);
    });

    it('records results when a step throws, using an "unknown" step marker', async () => {
      const err = new Error('Execution error');
      executeStepStub.rejects(err);

      await executeDecisionRule(mockRule, mockEvent, mockUser);

      expect(executeStepStub.callCount).toBe(1);

      expect(handleDecisionRuleResultStub.calledOnce).toBe(true);
      const payload = handleDecisionRuleResultStub.firstCall.args[0];

      expect(payload.event).toBe(mockEvent);
      expect(payload.name).toBe(mockRule.name);
      expect(payload.user).toBe(mockUser);

      expect(Array.isArray(payload.steps)).toBe(true);
      expect(payload.steps.length).toBe(1);
      expect(payload.steps[0].step).toBe('unknown');
    });
  });
});
