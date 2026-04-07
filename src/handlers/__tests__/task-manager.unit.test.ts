import sinon from 'sinon';
import { makeEngineSandbox, makeEvent, makeEngineTestUser } from '../../testing';
import {
  registerTask,
  getTaskByName,
  executeTask,
  _clearRegisteredTasks,
} from '../task-manager';
import * as Steps from '../steps';
import * as ResultRecorder from '../result-recorder';
import { HandlerType, TaskStep } from '../types';
import type { Task, TaskRegistration } from '../types';

describe('handlers/task-manager', () => {
  const engineSandbox = makeEngineSandbox();
  let executeStepStub: sinon.SinonStub;
  let handleTaskResultStub: sinon.SinonStub;

  beforeEach(() => {
    engineSandbox.reset();
    executeStepStub = engineSandbox.sb.stub(Steps, 'executeStep');
    handleTaskResultStub = engineSandbox.sb
      .stub(ResultRecorder, 'handleTaskResult')
      .resolves();
  });

  afterEach(() => {
    engineSandbox.restore();
  });

  function makeTask(overrides: Partial<Task> = {}): Task {
    return {
      name: 'testTask',
      type: HandlerType.TASK,
      shouldActivate: async () => ({ status: 'success' }),
      doAction: async () => ({ status: 'success' }),
      ...overrides,
    };
  }

  describe('registerTask', () => {
    it('registers a task retrievable by name', () => {
      const reg: TaskRegistration = {
        name: 'myTask',
        shouldActivate: async () => ({ status: 'success' }),
        doAction: async () => ({ status: 'success' }),
      };

      registerTask(reg);

      const task = getTaskByName('myTask');
      expect(task?.name).toBe('myTask');
    });

    it('stamps type as TASK', () => {
      registerTask({
        name: 'typed',
        shouldActivate: async () => ({ status: 'success' }),
        doAction: async () => ({ status: 'success' }),
      });

      expect(getTaskByName('typed')?.type).toBe(HandlerType.TASK);
    });

    it('overwrites a previous registration under the same name', () => {
      const v1: TaskRegistration = {
        name: 'dup',
        shouldActivate: async () => ({ status: 'stop' }),
        doAction: async () => ({ status: 'success' }),
      };
      const v2: TaskRegistration = {
        name: 'dup',
        shouldActivate: async () => ({ status: 'success' }),
        doAction: async () => ({ status: 'success' }),
      };

      registerTask(v1);
      registerTask(v2);

      expect(getTaskByName('dup')!.shouldActivate).toBe(v2.shouldActivate);
    });
  });

  describe('getTaskByName', () => {
    it('returns undefined for an unregistered name', () => {
      expect(getTaskByName('ghost')).toBeUndefined();
    });
  });

  describe('executeTask', () => {
    const user = makeEngineTestUser({ id: 'u1', uniqueIdentifier: 'alice' });
    const event = makeEvent({ eventType: 'TEST_EVENT' });

    it('runs shouldActivate then doAction when shouldActivate succeeds', async () => {
      executeStepStub
        .onCall(0).resolves({
        step: TaskStep.SHOULD_ACTIVATE,
        result: { status: 'success' },
        timestamp: new Date(),
      })
        .onCall(1).resolves({
        step: TaskStep.DO_ACTION,
        result: { status: 'success' },
        timestamp: new Date(),
      });

      await executeTask(makeTask(), event, user);

      expect(executeStepStub.callCount).toBe(2);
      expect(handleTaskResultStub.calledOnce).toBe(true);

      const { steps } = handleTaskResultStub.firstCall.args[0];
      expect(steps).toHaveLength(2);
      expect(steps[0].step).toBe(TaskStep.SHOULD_ACTIVATE);
      expect(steps[1].step).toBe(TaskStep.DO_ACTION);
    });

    it('skips doAction and does not record when shouldActivate is not success', async () => {
      executeStepStub.onCall(0).resolves({
        step: TaskStep.SHOULD_ACTIVATE,
        result: { status: 'stop' },
        timestamp: new Date(),
      });

      await executeTask(makeTask(), event, user);

      expect(executeStepStub.callCount).toBe(1);
      expect(handleTaskResultStub.called).toBe(false);
    });

    it('skips doAction and does not record when shouldActivate returns error', async () => {
      executeStepStub.onCall(0).resolves({
        step: TaskStep.SHOULD_ACTIVATE,
        result: { status: 'error', error: new Error('check failed') },
        timestamp: new Date(),
      });

      await executeTask(makeTask(), event, user);

      expect(executeStepStub.callCount).toBe(1);
      expect(handleTaskResultStub.called).toBe(false);
    });

    it('passes shouldActivate result as previousResult to doAction', async () => {
      const shouldActivateResult = {
        step: TaskStep.SHOULD_ACTIVATE,
        result: { status: 'success' as const, result: { phase: 'active' } },
        timestamp: new Date(),
      };

      executeStepStub
        .onCall(0).resolves(shouldActivateResult)
        .onCall(1).resolves({
        step: TaskStep.DO_ACTION,
        result: { status: 'success' },
        timestamp: new Date(),
      });

      await executeTask(makeTask(), event, user);

      const doActionCall = executeStepStub.secondCall;
      const doActionFn = doActionCall.args[1] as () => Promise<unknown>;
      expect(doActionCall.args[0]).toBe(TaskStep.DO_ACTION);

      // Verify the fn passed to executeStep calls task.doAction with prev result
      const task = makeTask();
      const doActionSpy = sinon.spy(task, 'doAction');
      executeStepStub.onCall(0).resolves(shouldActivateResult);
      executeStepStub.onCall(1).callsFake(async (_step: string, fn: () => Promise<unknown>) => {
        await fn();
        return { step: TaskStep.DO_ACTION, result: { status: 'success' }, timestamp: new Date() };
      });

      await executeTask(task, event, user);
      expect(doActionSpy.firstCall.args[2]).toEqual(shouldActivateResult.result);
    });

    it('records an unknown error step when executeStep throws unexpectedly', async () => {
      executeStepStub.rejects(new Error('unexpected'));

      await executeTask(makeTask(), event, user);

      expect(handleTaskResultStub.calledOnce).toBe(true);
      const { steps } = handleTaskResultStub.firstCall.args[0];
      expect(steps).toHaveLength(1);
      expect(steps[0].step).toBe('unknown');
      expect(steps[0].result.status).toBe('error');
    });

    it('includes event, name, and user in the recorded result', async () => {
      executeStepStub
        .onCall(0).resolves({ step: TaskStep.SHOULD_ACTIVATE, result: { status: 'success' }, timestamp: new Date() })
        .onCall(1).resolves({ step: TaskStep.DO_ACTION, result: { status: 'success' }, timestamp: new Date() });

      const task = makeTask({ name: 'namedTask' });
      await executeTask(task, event, user);

      const payload = handleTaskResultStub.firstCall.args[0];
      expect(payload.name).toBe('namedTask');
      expect(payload.event).toBe(event);
      expect(payload.user).toBe(user);
    });

    it('does not throw when handleTaskResult throws', async () => {
      executeStepStub
        .onCall(0).resolves({ step: TaskStep.SHOULD_ACTIVATE, result: { status: 'success' }, timestamp: new Date() })
        .onCall(1).resolves({ step: TaskStep.DO_ACTION, result: { status: 'success' }, timestamp: new Date() });
      handleTaskResultStub.rejects(new Error('recorder broke'));

      await expect(executeTask(makeTask(), event, user)).resolves.toBeUndefined();
    });

    it('logs an error when handleTaskResult throws', async () => {
      executeStepStub
        .onCall(0).resolves({ step: TaskStep.SHOULD_ACTIVATE, result: { status: 'success' }, timestamp: new Date() })
        .onCall(1).resolves({ step: TaskStep.DO_ACTION, result: { status: 'success' }, timestamp: new Date() });
      handleTaskResultStub.rejects(new Error('recorder broke'));

      await executeTask(makeTask(), event, user);

      const errorLogs = engineSandbox.logs.findByMessage('Error in handleTaskResult');
      expect(errorLogs).toHaveLength(1);
      expect(errorLogs[0].entry.severity).toBe('ERROR');
    });
  });

  describe('_clearRegisteredTasks', () => {
    it('removes all registered tasks', () => {
      registerTask({
        name: 'toRemove',
        shouldActivate: async () => ({ status: 'success' }),
        doAction: async () => ({ status: 'success' }),
      });

      _clearRegisteredTasks();

      expect(getTaskByName('toRemove')).toBeUndefined();
    });
  });
});
