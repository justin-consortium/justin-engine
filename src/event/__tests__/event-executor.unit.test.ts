import { makeEngineSandbox } from '../../testing/testkit';
import { makeEvent } from '../../testing/helpers/factories';

import { EventHandlerManager } from '../event-handler-manager';
import { executeEventForUsers } from '../event-executor';

import * as TaskManager from '../../handlers/task.manager';
import * as DecisionRuleManager from '../../handlers/decision-rule.manager';

import { makeUser } from '@just-in/core/testing';

describe('executeEventForUsers', () => {
  const engineSandbox = makeEngineSandbox();

  beforeEach(async () => {
    await engineSandbox.reset();
  });

  afterEach(async () => {
    await engineSandbox.restore();
  });

  function makeUsers(n: number) {
    return Array.from({ length: n }, (_, i) =>
      makeUser({
        id: `u${i + 1}`,
        uniqueIdentifier: `u${i + 1}`,
      }),
    );
  }

  it('returns early when no handlers are registered for the event type', async () => {
    // Arrange
    const mgr = EventHandlerManager.getInstance();
    const getHandlersStub = engineSandbox.sb.stub(mgr, 'getHandlersForEventType').returns([]);
    const executeTaskStub = engineSandbox.sb.stub(TaskManager, 'executeTask');
    const executeDecisionRuleStub = engineSandbox.sb.stub(DecisionRuleManager, 'executeDecisionRule');

    const event = makeEvent({ eventType: 'TEST_EVENT' });
    const users = makeUsers(2);

    // Act
    await executeEventForUsers(event, users, mgr);

    // Assert (behavior: nothing executes)
    expect(getHandlersStub.calledOnceWith('TEST_EVENT')).toBe(true);
    expect(executeTaskStub.called).toBe(false);
    expect(executeDecisionRuleStub.called).toBe(false);
  });
  //
  // it('executes a task: beforeExecution once, per-user execution, afterExecution once', async () => {
  //   // Arrange
  //   const mgr = EventHandlerManager.getInstance();
  //   const event = makeEvent({ eventType: 'TEST_EVENT' });
  //   const users = makeUsers(2);
  //
  //   const beforeExecution = s.sb.stub().resolves();
  //   const afterExecution = s.sb.stub().resolves();
  //
  //   const task = registerTestTask({
  //     name: 'taskA',
  //     beforeExecution,
  //     afterExecution,
  //   });
  //
  //   s.sb.stub(mgr, 'getHandlersForEventType').returns(['taskA']);
  //
  //   const executeTaskStub = s.sb.stub(TaskManager, 'executeTask').resolves();
  //   const executeDecisionRuleStub = s.sb.stub(DecisionRuleManager, 'executeDecisionRule');
  //
  //   // Act
  //   await executeEventForUsers(event, users, mgr);
  //
  //   // Assert
  //   expect(beforeExecution.calledOnceWith(event)).toBe(true);
  //   expect(afterExecution.calledOnceWith(event)).toBe(true);
  //
  //   expect(executeTaskStub.callCount).toBe(2);
  //   expect(executeTaskStub.firstCall.calledWith(task, event, users[0])).toBe(true);
  //   expect(executeTaskStub.secondCall.calledWith(task, event, users[1])).toBe(true);
  //
  //   expect(executeDecisionRuleStub.called).toBe(false);
  // });
  //
  // it('continues to the next user when task execution throws for one user', async () => {
  //   // Arrange
  //   const mgr = EventHandlerManager.getInstance();
  //   const event = makeEvent({ eventType: 'TEST_EVENT' });
  //   const users = makeUsers(2);
  //
  //   const task = registerTestTask({ name: 'taskA' });
  //
  //   s.sb.stub(mgr, 'getHandlersForEventType').returns(['taskA']);
  //
  //   const executeTaskStub = s.sb.stub(TaskManager, 'executeTask');
  //   executeTaskStub.onFirstCall().rejects(new Error('u1-fail'));
  //   executeTaskStub.onSecondCall().resolves();
  //
  //   // Act
  //   await executeEventForUsers(event, users, mgr);
  //
  //   // Assert (behavior: both users attempted)
  //   expect(executeTaskStub.callCount).toBe(2);
  //   expect(executeTaskStub.firstCall.calledWith(task, event, users[0])).toBe(true);
  //   expect(executeTaskStub.secondCall.calledWith(task, event, users[1])).toBe(true);
  // });
  //
  // it('executes a decision rule when no task exists for the handler name', async () => {
  //   // Arrange
  //   const mgr = EventHandlerManager.getInstance();
  //   const event = makeEvent({ eventType: 'TEST_EVENT' });
  //   const users = makeUsers(2);
  //
  //   const beforeExecution = s.sb.stub().resolves();
  //   const afterExecution = s.sb.stub().resolves();
  //
  //   const rule = registerTestDecisionRule({
  //     name: 'ruleA',
  //     beforeExecution,
  //     afterExecution,
  //   });
  //
  //   s.sb.stub(mgr, 'getHandlersForEventType').returns(['ruleA']);
  //
  //   const executeTaskStub = s.sb.stub(TaskManager, 'executeTask');
  //   const executeDecisionRuleStub = s.sb
  //     .stub(DecisionRuleManager, 'executeDecisionRule')
  //     .resolves();
  //
  //   // Act
  //   await executeEventForUsers(event, users, mgr);
  //
  //   // Assert
  //   expect(beforeExecution.calledOnceWith(event)).toBe(true);
  //   expect(afterExecution.calledOnceWith(event)).toBe(true);
  //
  //   expect(executeDecisionRuleStub.callCount).toBe(2);
  //   expect(executeDecisionRuleStub.firstCall.calledWith(rule, event, users[0])).toBe(true);
  //   expect(executeDecisionRuleStub.secondCall.calledWith(rule, event, users[1])).toBe(true);
  //
  //   expect(executeTaskStub.called).toBe(false);
  // });
  //
  // it('continues to the next user when decision rule execution throws for one user', async () => {
  //   // Arrange
  //   const mgr = EventHandlerManager.getInstance();
  //   const event = makeEvent({ eventType: 'TEST_EVENT' });
  //   const users = makeUsers(2);
  //
  //   const rule = registerTestDecisionRule({ name: 'ruleA' });
  //
  //   s.sb.stub(mgr, 'getHandlersForEventType').returns(['ruleA']);
  //
  //   const executeDecisionRuleStub = s.sb.stub(DecisionRuleManager, 'executeDecisionRule');
  //   executeDecisionRuleStub.onFirstCall().rejects(new Error('u1-fail'));
  //   executeDecisionRuleStub.onSecondCall().resolves();
  //
  //   // Act
  //   await executeEventForUsers(event, users, mgr);
  //
  //   // Assert
  //   expect(executeDecisionRuleStub.callCount).toBe(2);
  //   expect(executeDecisionRuleStub.firstCall.calledWith(rule, event, users[0])).toBe(true);
  //   expect(executeDecisionRuleStub.secondCall.calledWith(rule, event, users[1])).toBe(true);
  // });
  //
  // it('skips execution when handler name resolves to neither a task nor a decision rule', async () => {
  //   // Arrange
  //   const mgr = EventHandlerManager.getInstance();
  //   const event = makeEvent({ eventType: 'TEST_EVENT' });
  //   const users = makeUsers(2);
  //
  //   s.sb.stub(mgr, 'getHandlersForEventType').returns(['ghost']);
  //
  //   const executeTaskStub = s.sb.stub(TaskManager, 'executeTask');
  //   const executeDecisionRuleStub = s.sb.stub(DecisionRuleManager, 'executeDecisionRule');
  //
  //   // Act
  //   await executeEventForUsers(event, users, mgr);
  //
  //   // Assert (behavior: no executions)
  //   expect(executeTaskStub.called).toBe(false);
  //   expect(executeDecisionRuleStub.called).toBe(false);
  // });
  //
  // it('runs beforeExecution only once even if the handler list contains duplicates', async () => {
  //   // Arrange
  //   const mgr = EventHandlerManager.getInstance();
  //   const event = makeEvent({ eventType: 'TEST_EVENT' });
  //   const users = makeUsers(2);
  //
  //   const beforeExecution = s.sb.stub().resolves();
  //   const afterExecution = s.sb.stub().resolves();
  //
  //   const task = registerTestTask({
  //     name: 'taskA',
  //     beforeExecution,
  //     afterExecution,
  //   });
  //
  //   // Duplicate handler entry
  //   s.sb.stub(mgr, 'getHandlersForEventType').returns(['taskA', 'taskA']);
  //
  //   const executeTaskStub = s.sb.stub(TaskManager, 'executeTask').resolves();
  //
  //   // Act
  //   await executeEventForUsers(event, users, mgr);
  //
  //   // Assert
  //   expect(beforeExecution.calledOnce).toBe(true);
  //   expect(beforeExecution.firstCall.calledWithExactly(event)).toBe(true);
  //
  //   // Still executes per user per occurrence: 2 users * 2 occurrences = 4
  //   expect(executeTaskStub.callCount).toBe(4);
  //
  //   // Each call is for the same task + event, and a user from our list
  //   executeTaskStub.getCalls().forEach((call) => {
  //     expect(call.args[0]).toBe(task);
  //     expect(call.args[1]).toBe(event);
  //     expect(users).toContain(call.args[2]);
  //   });
  //
  //   // And each user is executed twice (because handler is duplicated)
  //   const calledUserIds = executeTaskStub.getCalls().map((c) => c.args[2].id);
  //   const u1Count = calledUserIds.filter((id) => id === users[0].id).length;
  //   const u2Count = calledUserIds.filter((id) => id === users[1].id).length;
  //
  //   expect(u1Count).toBe(2);
  //   expect(u2Count).toBe(2);
  // });
  //
  // it('runs afterExecution only once even if the handler list contains duplicates', async () => {
  //   // Arrange
  //   const mgr = EventHandlerManager.getInstance();
  //   const event = makeEvent({ eventType: 'TEST_EVENT' });
  //   const users = makeUsers(2);
  //
  //   const beforeExecution = s.sb.stub().resolves();
  //   const afterExecution = s.sb.stub().resolves();
  //
  //   const task = registerTestTask({
  //     name: 'taskA',
  //     beforeExecution,
  //     afterExecution,
  //   });
  //
  //   // Duplicate handler entry
  //   s.sb.stub(mgr, 'getHandlersForEventType').returns(['taskA', 'taskA']);
  //
  //   const executeTaskStub = s.sb.stub(TaskManager, 'executeTask').resolves();
  //
  //   // Act
  //   await executeEventForUsers(event, users, mgr);
  //
  //   // Assert
  //   expect(afterExecution.calledOnce).toBe(true);
  //   expect(afterExecution.firstCall.calledWithExactly(event)).toBe(true);
  //
  //   // Still executes per user per occurrence: 2 users * 2 occurrences = 4
  //   expect(executeTaskStub.callCount).toBe(4);
  //
  //   // Each call is for the same task + event, and a user from our list
  //   executeTaskStub.getCalls().forEach((call) => {
  //     expect(call.args[0]).toBe(task);
  //     expect(call.args[1]).toBe(event);
  //     expect(users).toContain(call.args[2]);
  //   });
  //
  //   // And each user is executed twice (because handler is duplicated)
  //   const calledUserIds = executeTaskStub.getCalls().map((c) => c.args[2].id);
  //   const u1Count = calledUserIds.filter((id) => id === users[0].id).length;
  //   const u2Count = calledUserIds.filter((id) => id === users[1].id).length;
  //
  //   expect(u1Count).toBe(2);
  //   expect(u2Count).toBe(2);
  // });
  //
  //
  // it('prefers task over decision rule when both exist for the same handler name', async () => {
  //   // Arrange
  //   const mgr = EventHandlerManager.getInstance();
  //   const event = makeEvent({ eventType: 'TEST_EVENT' });
  //   const users = makeUsers(2);
  //
  //   const task = registerTestTask({ name: 'handlerX' });
  //   registerTestDecisionRule({ name: 'handlerX' });
  //
  //   s.sb.stub(mgr, 'getHandlersForEventType').returns(['handlerX']);
  //
  //   const executeTaskStub = s.sb.stub(TaskManager, 'executeTask').resolves();
  //   const executeDecisionRuleStub = s.sb.stub(DecisionRuleManager, 'executeDecisionRule');
  //
  //   // Act
  //   await executeEventForUsers(event, users, mgr);
  //
  //   // Assert
  //   expect(executeTaskStub.callCount).toBe(2);
  //   expect(executeTaskStub.firstCall.calledWith(task, event, users[0])).toBe(true);
  //   expect(executeTaskStub.secondCall.calledWith(task, event, users[1])).toBe(true);
  //
  //   expect(executeDecisionRuleStub.called).toBe(false);
  // });
});
