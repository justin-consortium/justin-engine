import sinon from 'sinon';
import { makeEngineSandbox } from '../../testing';
import * as CoreModule from '@just-in/core';
import { JustIn, _resetEngine, _getIntervalTimers } from '../engine';
import { EventHandlerManager } from '../../event/manager';
import * as Queue from '../../event/queue';

describe('engine/engine — JustIn', () => {
  const engineSandbox = makeEngineSandbox();

  let userManagerInitStub: sinon.SinonStub;
  let shutdownCoreStub: sinon.SinonStub;
  let startQueueStub: sinon.SinonStub;
  let stopQueueStub: sinon.SinonStub;
  let processQueueStub: sinon.SinonStub;

  beforeEach(() => {
    engineSandbox.reset();
    _resetEngine();

    userManagerInitStub = engineSandbox.sb.stub(CoreModule.UserManager, 'init').resolves();
    shutdownCoreStub = engineSandbox.sb.stub(CoreModule, 'shutdownCore').resolves();
    startQueueStub = engineSandbox.sb.stub(Queue, 'startEventQueueProcessing').resolves();
    stopQueueStub = engineSandbox.sb.stub(Queue, 'stopEventQueueProcessing');
    processQueueStub = engineSandbox.sb.stub(Queue, 'processEventQueue').resolves();
  });

  afterEach(() => {
    engineSandbox.restore();
  });

  describe('init', () => {
    it('calls UserManager.init', async () => {
      await JustIn.init();

      expect(userManagerInitStub.calledOnce).toBe(true);
    });

    it('is idempotent — skips on second call without calling UserManager.init again', async () => {
      await JustIn.init();
      await JustIn.init();

      expect(userManagerInitStub.callCount).toBe(1);
    });

    it('logs a warning on the second call', async () => {
      await JustIn.init();
      await JustIn.init();

      const warnLogs = engineSandbox.logs.findByMessage('already initialized');
      expect(warnLogs).toHaveLength(1);
    });

    it('throws when UserManager.init throws', async () => {
      userManagerInitStub.rejects(new Error('db not configured'));

      await expect(JustIn.init()).rejects.toThrow('db not configured');
    });
  });

  describe('shutdown', () => {
    it('calls shutdownCore after stopping the engine', async () => {
      await JustIn.init();
      await JustIn.shutdown();

      expect(stopQueueStub.calledOnce).toBe(true);
      expect(shutdownCoreStub.calledOnce).toBe(true);
    });

    it('is a no-op when not initialized', async () => {
      await JustIn.shutdown();

      expect(shutdownCoreStub.called).toBe(false);
    });

    it('logs a warning when called before init', async () => {
      await JustIn.shutdown();

      const warnLogs = engineSandbox.logs.findByMessage('not initialized');
      expect(warnLogs).toHaveLength(1);
    });

    it('clears event handlers on shutdown', async () => {
      await JustIn.init();
      await JustIn.registerEventHandlers('EV', ['h1']);

      await JustIn.shutdown();

      expect(EventHandlerManager.getInstance().hasHandlersForEventType('EV')).toBe(false);
    });

    it('clears interval timers on shutdown', async () => {
      await JustIn.init();
      JustIn.createIntervalTimerEventGenerator('TIMER_EV', 1000);

      await JustIn.shutdown();

      expect(_getIntervalTimers().size).toBe(0);
    });

    it('rethrows errors from shutdownCore', async () => {
      await JustIn.init();
      shutdownCoreStub.rejects(new Error('shutdown failed'));

      await expect(JustIn.shutdown()).rejects.toThrow('shutdown failed');
    });
  });

  describe('startEngine', () => {
    it('starts event queue processing and drains the queue', async () => {
      await JustIn.init();
      await JustIn.startEngine();

      expect(startQueueStub.calledOnce).toBe(true);
      expect(processQueueStub.calledOnce).toBe(true);
    });

    it('starts all registered interval timers', async () => {
      await JustIn.init();
      JustIn.createIntervalTimerEventGenerator('TIMER_EV', 1000);

      const timer = _getIntervalTimers().get('TIMER_EV')!;
      const startSpy = engineSandbox.sb.spy(timer, 'start');

      await JustIn.startEngine();

      expect(startSpy.calledOnce).toBe(true);
    });
  });

  describe('stopEngine', () => {
    it('stops event queue processing', async () => {
      await JustIn.init();
      await JustIn.stopEngine();

      expect(stopQueueStub.calledOnce).toBe(true);
    });

    it('stops all registered interval timers', async () => {
      await JustIn.init();
      JustIn.createIntervalTimerEventGenerator('TIMER_EV', 1000);

      const timer = _getIntervalTimers().get('TIMER_EV')!;
      const stopSpy = engineSandbox.sb.spy(timer, 'stop');

      await JustIn.stopEngine();

      expect(stopSpy.calledOnce).toBe(true);
    });
  });

  describe('registerTask', () => {
    it('registers a task that can be retrieved from the task registry', () => {
      const { getTaskByName } = require('../../handlers/task-manager');

      JustIn.registerTask({
        name: 'myTask',
        shouldActivate: async () => ({ status: 'success' }),
        doAction: async () => ({ status: 'success' }),
      });

      expect(getTaskByName('myTask')).toBeDefined();
    });
  });

  describe('registerDecisionRule', () => {
    it('registers a rule that can be retrieved from the rule registry', () => {
      const { getDecisionRuleByName } = require('../../handlers/decision-rule-manager');

      JustIn.registerDecisionRule({
        name: 'myRule',
        shouldActivate: async () => ({ status: 'success' }),
        selectAction: async () => ({ status: 'success' }),
        doAction: async () => ({ status: 'success' }),
      });

      expect(getDecisionRuleByName('myRule')).toBeDefined();
    });
  });

  describe('registerEventHandlers', () => {
    it('registers event handlers on the EventHandlerManager', async () => {
      await JustIn.registerEventHandlers('MY_EVENT', ['task1', 'rule1']);

      expect(
        EventHandlerManager.getInstance().hasHandlersForEventType('MY_EVENT'),
      ).toBe(true);
    });

    it('throws when event type is already registered', async () => {
      await JustIn.registerEventHandlers('DUP', ['h1']);

      await expect(JustIn.registerEventHandlers('DUP', ['h2'])).rejects.toThrow(
        'already registered',
      );
    });

    it('overwrites when overwriteExisting is true', async () => {
      await JustIn.registerEventHandlers('OW', ['h1']);
      await JustIn.registerEventHandlers('OW', ['h2'], true);

      expect(
        EventHandlerManager.getInstance().getHandlersForEventType('OW'),
      ).toEqual(['h2']);
    });
  });

  describe('publishEvent', () => {
    it('delegates to the queue publishEvent function', async () => {
      const publishStub = engineSandbox.sb
        .stub(Queue, 'publishEvent')
        .resolves();

      const ts = new Date();
      await JustIn.publishEvent('EV', ts, { key: 'val' });

      expect(publishStub.calledOnceWith('EV', ts, { key: 'val' })).toBe(true);
    });
  });

  describe('createIntervalTimerEventGenerator', () => {
    it('adds a timer to the internal map', () => {
      JustIn.createIntervalTimerEventGenerator('TIMER_EV', 1000);

      expect(_getIntervalTimers().has('TIMER_EV')).toBe(true);
    });

    it('overwrites an existing timer with the same event type name', () => {
      JustIn.createIntervalTimerEventGenerator('TIMER_EV', 1000);
      const first = _getIntervalTimers().get('TIMER_EV');

      JustIn.createIntervalTimerEventGenerator('TIMER_EV', 2000);
      const second = _getIntervalTimers().get('TIMER_EV');

      expect(first).not.toBe(second);
    });
  });

  describe('configureTaskResultWriter / configureDecisionRuleResultWriter', () => {
    it('configureTaskResultWriter sets the task recorder', async () => {
      const writer = jest.fn().mockResolvedValue(undefined);
      JustIn.configureTaskResultWriter(writer);

      const { handleTaskResult } = require('../../handlers/result-recorder');
      const { __resetResultRecorderForTests } = require('../../handlers/result-recorder');

      // verify writer is called via handleTaskResult
      const record = {
        event: { eventType: 'EV', generatedTimestamp: new Date() },
        name: 'task',
        user: { id: 'u1', uniqueIdentifier: 'u1' },
        steps: [{ step: 'shouldActivate', result: { status: 'success' }, timestamp: new Date() }],
      };
      await handleTaskResult(record);

      expect(writer).toHaveBeenCalledWith(record);
      __resetResultRecorderForTests();
    });

    it('configureDecisionRuleResultWriter sets the decision rule recorder', async () => {
      const writer = jest.fn().mockResolvedValue(undefined);
      JustIn.configureDecisionRuleResultWriter(writer);

      const { handleDecisionRuleResult, __resetResultRecorderForTests } =
        require('../../handlers/result-recorder');

      const record = {
        event: { eventType: 'EV', generatedTimestamp: new Date() },
        name: 'rule',
        user: { id: 'u1', uniqueIdentifier: 'u1' },
        steps: [{ step: 'shouldActivate', result: { status: 'success' }, timestamp: new Date() }],
      };
      await handleDecisionRuleResult(record);

      expect(writer).toHaveBeenCalledWith(record);
      __resetResultRecorderForTests();
    });
  });

  describe('_resetEngine', () => {
    it('resets initialization state', async () => {
      await JustIn.init();
      _resetEngine();

      // after reset, init should call UserManager.init again
      await JustIn.init();
      expect(userManagerInitStub.callCount).toBe(2);
    });

    it('clears interval timers', () => {
      JustIn.createIntervalTimerEventGenerator('EV', 1000);
      _resetEngine();

      expect(_getIntervalTimers().size).toBe(0);
    });
  });
});
