import sinon from 'sinon';
import type { EngineSandbox } from '../../testing';
import {
  makeEngineSandbox,
  makeEvent,
  makeEngineTestUser,
  registerTestTask,
  registerTestDecisionRule,
} from '../../testing';
import { EventHandlerManager } from '../manager';
import { executeEventForUsers } from '../executor';
import * as TaskManager from '../../handlers/task.manager';
import * as DecisionRuleManager from '../../handlers/decision-rule.manager';

describe('event/executor — unit test', () => {
  let engineSandbox: EngineSandbox;
  let mgr: EventHandlerManager;

  beforeEach(async () => {
    engineSandbox = makeEngineSandbox();
    mgr = EventHandlerManager.getInstance();
  });

  afterEach(() => engineSandbox.restore());

  const user1 = makeEngineTestUser({ id: 'u1', uniqueIdentifier: 'alice' });
  const user2 = makeEngineTestUser({ id: 'u2', uniqueIdentifier: 'bob' });

  describe('no handlers registered', () => {
    it('resolves without error when no handlers are registered for the event type', async () => {
      await expect(executeEventForUsers(makeEvent({ eventType: 'UNKNOWN' }), [user1], mgr)).resolves.toBeUndefined();
    });

    it('logs a warning when no handlers are registered', async () => {
      await executeEventForUsers(makeEvent({ eventType: 'UNKNOWN' }), [user1], mgr);
      const warnLogs = engineSandbox.logs.findByMessage('No handlers registered');
      expect(warnLogs).toHaveLength(1);
      expect(warnLogs[0].entry.severity).toBe('WARNING');
    });
  });

  describe('handler not found in registry', () => {
    it('skips a handler name not registered as task or rule and continues', async () => {
      await mgr.registerEventHandlers('EV', ['notRegistered']);
      const executeTaskStub = engineSandbox.sb.stub(TaskManager, 'executeTask').resolves();

      await executeEventForUsers(makeEvent({ eventType: 'EV' }), [user1], mgr);

      expect(executeTaskStub.called).toBe(false);
      const warnLogs = engineSandbox.logs.findByMessage('Handler not found in registry');
      expect(warnLogs).toHaveLength(1);
    });
  });

  describe('task execution', () => {
    it('calls executeTask for each user', async () => {
      registerTestTask({ name: 'myTask' });
      await mgr.registerEventHandlers('EV', ['myTask']);
      const executeTaskStub = engineSandbox.sb.stub(TaskManager, 'executeTask').resolves();

      const event = makeEvent({ eventType: 'EV' });
      await executeEventForUsers(event, [user1, user2], mgr);

      expect(executeTaskStub.callCount).toBe(2);
      expect(executeTaskStub.firstCall.args[1]).toBe(event);
      expect(executeTaskStub.firstCall.args[2]).toBe(user1);
      expect(executeTaskStub.secondCall.args[2]).toBe(user2);
    });

    it('calls beforeExecution once before the user sweep', async () => {
      const beforeSpy = sinon.spy();
      registerTestTask({ name: 'beforeTask', beforeExecution: beforeSpy });
      await mgr.registerEventHandlers('EV', ['beforeTask']);
      engineSandbox.sb.stub(TaskManager, 'executeTask').resolves();

      const event = makeEvent({ eventType: 'EV' });
      await executeEventForUsers(event, [user1, user2], mgr);

      expect(beforeSpy.callCount).toBe(1);
      expect(beforeSpy.firstCall.args[0]).toBe(event);
    });

    it('calls afterExecution once after the user sweep', async () => {
      const afterSpy = sinon.spy();
      registerTestTask({ name: 'afterTask', afterExecution: afterSpy });
      await mgr.registerEventHandlers('EV', ['afterTask']);
      engineSandbox.sb.stub(TaskManager, 'executeTask').resolves();

      const event = makeEvent({ eventType: 'EV' });
      await executeEventForUsers(event, [user1, user2], mgr);

      expect(afterSpy.callCount).toBe(1);
      expect(afterSpy.firstCall.args[0]).toBe(event);
    });
  });

  describe('decision rule execution', () => {
    it('calls executeDecisionRule for each user', async () => {
      registerTestDecisionRule({ name: 'myRule' });
      await mgr.registerEventHandlers('EV', ['myRule']);
      const executeRuleStub = engineSandbox.sb.stub(DecisionRuleManager, 'executeDecisionRule').resolves();

      await executeEventForUsers(makeEvent({ eventType: 'EV' }), [user1, user2], mgr);

      expect(executeRuleStub.callCount).toBe(2);
    });
  });

  describe('mixed task and decision rule pipeline', () => {
    it('runs handlers in registration order', async () => {
      const order: string[] = [];
      registerTestTask({ name: 'task1' });
      registerTestDecisionRule({ name: 'rule1' });
      registerTestTask({ name: 'task2' });
      await mgr.registerEventHandlers('EV', ['task1', 'rule1', 'task2']);

      engineSandbox.sb.stub(TaskManager, 'executeTask').callsFake(async (t) => { order.push(t.name); });
      engineSandbox.sb.stub(DecisionRuleManager, 'executeDecisionRule').callsFake(async (r) => { order.push(r.name); });

      await executeEventForUsers(makeEvent({ eventType: 'EV' }), [user1], mgr);

      expect(order).toEqual(['task1', 'rule1', 'task2']);
    });

    it('completes the full user sweep for each handler before starting the next', async () => {
      const log: string[] = [];
      registerTestTask({ name: 'fetchTask' });
      registerTestDecisionRule({ name: 'decideRule' });
      await mgr.registerEventHandlers('EV', ['fetchTask', 'decideRule']);

      engineSandbox.sb.stub(TaskManager, 'executeTask').callsFake(async (_t, _e, u) => {
        log.push(`fetch:${u.uniqueIdentifier}`);
      });
      engineSandbox.sb.stub(DecisionRuleManager, 'executeDecisionRule').callsFake(async (_r, _e, u) => {
        log.push(`decide:${u.uniqueIdentifier}`);
      });

      await executeEventForUsers(makeEvent({ eventType: 'EV' }), [user1, user2], mgr);

      expect(log).toEqual(['fetch:alice', 'fetch:bob', 'decide:alice', 'decide:bob']);
    });
  });

  describe('error isolation', () => {
    it('continues processing remaining users when one user throws', async () => {
      registerTestTask({ name: 'flakyTask' });
      await mgr.registerEventHandlers('EV', ['flakyTask']);

      let callCount = 0;
      engineSandbox.sb.stub(TaskManager, 'executeTask').callsFake(async () => {
        callCount++;
        if (callCount === 1) throw new Error('user1 exploded');
      });

      await executeEventForUsers(makeEvent({ eventType: 'EV' }), [user1, user2], mgr);

      expect(callCount).toBe(2);
    });

    it('logs an error when a per-user execution throws', async () => {
      registerTestTask({ name: 'errorTask' });
      await mgr.registerEventHandlers('EV', ['errorTask']);
      engineSandbox.sb.stub(TaskManager, 'executeTask').rejects(new Error('boom'));

      await executeEventForUsers(makeEvent({ eventType: 'EV' }), [user1], mgr);

      const errorLogs = engineSandbox.logs.findByMessage('Execution error for handler on user');
      expect(errorLogs).toHaveLength(1);
      expect(errorLogs[0].entry.severity).toBe('ERROR');
    });

    it('continues the user sweep when beforeExecution throws', async () => {
      registerTestTask({ name: 'beforeErrorTask', beforeExecution: async () => { throw new Error('before failed'); } });
      await mgr.registerEventHandlers('EV', ['beforeErrorTask']);
      const executeTaskStub = engineSandbox.sb.stub(TaskManager, 'executeTask').resolves();

      await executeEventForUsers(makeEvent({ eventType: 'EV' }), [user1, user2], mgr);

      expect(executeTaskStub.callCount).toBe(2);
      const errorLogs = engineSandbox.logs.findByMessage('beforeExecution failed');
      expect(errorLogs).toHaveLength(1);
    });

    it('continues to next handler when afterExecution throws', async () => {
      registerTestTask({ name: 'afterErrorTask', afterExecution: async () => { throw new Error('after failed'); } });
      registerTestTask({ name: 'nextTask' });
      await mgr.registerEventHandlers('EV', ['afterErrorTask', 'nextTask']);
      engineSandbox.sb.stub(TaskManager, 'executeTask').resolves();

      await expect(executeEventForUsers(makeEvent({ eventType: 'EV' }), [user1], mgr)).resolves.toBeUndefined();

      const errorLogs = engineSandbox.logs.findByMessage('afterExecution failed');
      expect(errorLogs).toHaveLength(1);
    });
  });
});
