/**
 * JustIn (DB-backed engine) E2E tests.
 *
 * Verifies the public API as a third-party developer would use it.
 * Imports from '@just-in/engine' and '@just-in/core' only — both are
 * public packages a consumer would have in their project.
 * Uses a real MongoMemoryReplSet.
 *
 * The guiding question: "Would a developer who only has the README write this?"
 */

import sinon from 'sinon';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { configureDB, DBType, shutdownCore, UserManager } from '@just-in/core';
import { waitForMongoReady, silenceLogger } from '@just-in/core/testing';
import { JustIn } from '../../index';
import type { TaskRegistration, DecisionRuleRegistration } from '../../index';

let repl: MongoMemoryReplSet;
let sb: sinon.SinonSandbox;
let dbIndex = 0;

// Each test gets its own database so user state never bleeds between tests.
function nextDb(): string {
  return `engine_e2e_${dbIndex++}`;
}

beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await waitForMongoReady(repl.getUri());
  sb = sinon.createSandbox();
  silenceLogger(sb);
}, 60_000);

afterAll(async () => {
  sb.restore();
  await repl.stop();
});

describe('engine/engine — e2e test', () => {
  beforeEach(() => {
    configureDB({ dbType: DBType.MONGO, uri: repl.getUri(), dbName: nextDb() });
  });

  afterEach(async () => {
    await JustIn.shutdown();
  });

  describe('init and shutdown', () => {
    it('initialises after configureDB is called', async () => {
      await expect(JustIn.init()).resolves.toBeUndefined();
    });

    it('init is idempotent — calling twice does not throw', async () => {
      await JustIn.init();
      await expect(JustIn.init()).resolves.toBeUndefined();
    });

    it('shutdown after init completes cleanly', async () => {
      await JustIn.init();
      await expect(JustIn.shutdown()).resolves.toBeUndefined();
    });
  });

  describe('task pipeline', () => {
    it('executes a task for each user when an event is published', async () => {
      await JustIn.init();
      await UserManager.createUser({ uniqueIdentifier: 'alice', attributes: {} });

      const executedFor: string[] = [];

      const task: TaskRegistration = {
        name: 'e2eTask',
        shouldActivate: async () => ({ status: 'success' }),
        doAction: async (user) => {
          executedFor.push(user.uniqueIdentifier);
          return { status: 'success' };
        },
      };

      JustIn.registerTask(task);
      await JustIn.registerEventHandlers('E2E_TASK_EVENT', ['e2eTask']);
      await JustIn.publishEvent('E2E_TASK_EVENT', new Date());
      await JustIn.startEngine();

      expect(executedFor).toEqual(['alice']);
    });

    it('does not run doAction when shouldActivate returns stop', async () => {
      await JustIn.init();
      await UserManager.createUser({ uniqueIdentifier: 'bob', attributes: {} });

      let doActionCalled = false;

      JustIn.registerTask({
        name: 'stopTask',
        shouldActivate: async () => ({ status: 'stop' }),
        doAction: async () => { doActionCalled = true; return { status: 'success' }; },
      });

      await JustIn.registerEventHandlers('STOP_TASK_EVENT', ['stopTask']);
      await JustIn.publishEvent('STOP_TASK_EVENT', new Date());
      await JustIn.startEngine();

      expect(doActionCalled).toBe(false);
    });
  });

  describe('decision rule pipeline', () => {
    it('runs all three steps when shouldActivate and selectAction succeed', async () => {
      await JustIn.init();
      await UserManager.createUser({ uniqueIdentifier: 'carol', attributes: {} });

      const steps: string[] = [];

      const rule: DecisionRuleRegistration = {
        name: 'e2eRule',
        shouldActivate: async () => { steps.push('shouldActivate'); return { status: 'success' }; },
        selectAction: async () => { steps.push('selectAction'); return { status: 'success' }; },
        doAction: async () => { steps.push('doAction'); return { status: 'success' }; },
      };

      JustIn.registerDecisionRule(rule);
      await JustIn.registerEventHandlers('E2E_RULE_EVENT', ['e2eRule']);
      await JustIn.publishEvent('E2E_RULE_EVENT', new Date());
      await JustIn.startEngine();

      expect(steps).toEqual(['shouldActivate', 'selectAction', 'doAction']);
    });

    it('skips doAction when selectAction returns stop', async () => {
      await JustIn.init();
      await UserManager.createUser({ uniqueIdentifier: 'dave', attributes: {} });

      const steps: string[] = [];

      JustIn.registerDecisionRule({
        name: 'selectStopRule',
        shouldActivate: async () => { steps.push('shouldActivate'); return { status: 'success' }; },
        selectAction: async () => { steps.push('selectAction'); return { status: 'stop' }; },
        doAction: async () => { steps.push('doAction'); return { status: 'success' }; },
      });

      await JustIn.registerEventHandlers('SELECT_STOP_EVENT', ['selectStopRule']);
      await JustIn.publishEvent('SELECT_STOP_EVENT', new Date());
      await JustIn.startEngine();

      expect(steps).toEqual(['shouldActivate', 'selectAction']);
    });
  });

  describe('handler ordering', () => {
    it('executes handlers in registration order — task before decision rule', async () => {
      await JustIn.init();
      await UserManager.createUser({ uniqueIdentifier: 'eve', attributes: {} });

      const order: string[] = [];

      JustIn.registerTask({
        name: 'firstTask',
        shouldActivate: async () => ({ status: 'success' }),
        doAction: async () => { order.push('task'); return { status: 'success' }; },
      });

      JustIn.registerDecisionRule({
        name: 'secondRule',
        shouldActivate: async () => ({ status: 'success' }),
        selectAction: async () => ({ status: 'success' }),
        doAction: async () => { order.push('rule'); return { status: 'success' }; },
      });

      await JustIn.registerEventHandlers('ORDER_EVENT', ['firstTask', 'secondRule']);
      await JustIn.publishEvent('ORDER_EVENT', new Date());
      await JustIn.startEngine();

      expect(order).toEqual(['task', 'rule']);
    });
  });

  describe('custom result writers', () => {
    it('configureTaskResultWriter receives the result envelope after task execution', async () => {
      await JustIn.init();
      await UserManager.createUser({ uniqueIdentifier: 'frank', attributes: {} });

      const captured: unknown[] = [];
      JustIn.configureTaskResultWriter(async (record) => { captured.push(record); });

      JustIn.registerTask({
        name: 'writerTask',
        shouldActivate: async () => ({ status: 'success' }),
        doAction: async () => ({ status: 'success' }),
      });

      await JustIn.registerEventHandlers('WRITER_EVENT', ['writerTask']);
      await JustIn.publishEvent('WRITER_EVENT', new Date());
      await JustIn.startEngine();

      expect(captured).toHaveLength(1);
      expect((captured[0] as Record<string, unknown>)['name']).toBe('writerTask');
    });

    it('configureDecisionRuleResultWriter receives the result envelope after rule execution', async () => {
      await JustIn.init();
      await UserManager.createUser({ uniqueIdentifier: 'grace', attributes: {} });

      const captured: unknown[] = [];
      JustIn.configureDecisionRuleResultWriter(async (record) => { captured.push(record); });

      JustIn.registerDecisionRule({
        name: 'writerRule',
        shouldActivate: async () => ({ status: 'success' }),
        selectAction: async () => ({ status: 'success' }),
        doAction: async () => ({ status: 'success' }),
      });

      await JustIn.registerEventHandlers('WRITER_RULE_EVENT', ['writerRule']);
      await JustIn.publishEvent('WRITER_RULE_EVENT', new Date());
      await JustIn.startEngine();

      expect(captured).toHaveLength(1);
      expect((captured[0] as Record<string, unknown>)['name']).toBe('writerRule');
    });
  });
});
