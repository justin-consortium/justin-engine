/**
 * @just-in/engine integration tests.
 *
 * Verifies collaboration between internal engine components against a real
 * MongoMemoryReplSet. Unlike unit tests which stub the next layer down,
 * integration tests let the full pipeline run — queue → executor → handlers
 * → DB — and assert on both execution behaviour and DB state.
 *
 * Internal imports are permitted here. The distinction between integration
 * and E2E is that integration tests may reach into internals to set up
 * state or assert on side effects; E2E tests use only the public API.
 */

import sinon from 'sinon';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { configureDB, DBType, shutdownCore, UserManager, DataManager } from '@just-in/core';
import { waitForMongoReady, expectOk, silenceLogger } from '@just-in/core/testing';
import { JustInEngine, _resetEngine } from '../engine';
import { EventHandlerManager } from '../../event/manager';
import {
  publishEvent,
  processEventQueue,
  queueIsEmpty,
  _setShouldProcessQueue,
} from '../../event/queue';
import { registerTestTask, registerTestDecisionRule } from '../../testing';
import { ARCHIVED_EVENTS } from '../../constants';

let repl: MongoMemoryReplSet;
let silenceSb: sinon.SinonSandbox;
let dbIndex = 0;

// Each test gets its own database so user state never bleeds between tests.
function nextDb(): string {
  return `engine_integration_${dbIndex++}`;
}

beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await waitForMongoReady(repl.getUri());
  silenceSb = sinon.createSandbox();
  silenceLogger(silenceSb);
}, 60_000);

afterAll(async () => {
  silenceSb.restore();
  await repl.stop();
});

describe('engine/engine — integration test', () => {
  beforeEach(async () => {
    configureDB({ dbType: DBType.MONGO, uri: repl.getUri(), dbName: nextDb() });
    await UserManager.init();
    _setShouldProcessQueue(true);
  });

  afterEach(async () => {
    await shutdownCore();
    _resetEngine();
    EventHandlerManager.getInstance().clearEventHandlers();
  });

  describe('init and shutdown lifecycle', () => {
    it('initialises successfully after configureDB has been called', async () => {
      await expect(JustInEngine.init()).resolves.toBeUndefined();
    });

    it('shuts down and allows re-initialisation', async () => {
      await JustInEngine.init();
      await JustInEngine.shutdown();

      configureDB({ dbType: DBType.MONGO, uri: repl.getUri(), dbName: nextDb() });
      await expect(JustInEngine.init()).resolves.toBeUndefined();
    });
  });

  describe('event queue — publish → process → archive', () => {
    it('publishes an event to the DB queue and processes it against users', async () => {
      await JustInEngine.init();

      const result = await UserManager.createUser({ uniqueIdentifier: 'alice', attributes: {} });
      expectOk(result);

      let executionCount = 0;
      registerTestTask({
        name: 'countTask',
        shouldActivate: async () => ({ status: 'success' }),
        doAction: async () => { executionCount++; return { status: 'success' }; },
      });

      await EventHandlerManager.getInstance().registerEventHandlers('COUNT_EVENT', ['countTask']);
      await publishEvent('COUNT_EVENT', new Date());
      await processEventQueue();

      expect(executionCount).toBe(1);
    });

    it('archives the event after processing — event moves from queue to archived_events', async () => {
      await JustInEngine.init();
      await UserManager.createUser({ uniqueIdentifier: 'bob', attributes: {} });

      registerTestTask({ name: 'archiveTask' });
      await EventHandlerManager.getInstance().registerEventHandlers('ARCHIVE_EVENT', ['archiveTask']);

      await publishEvent('ARCHIVE_EVENT', new Date());
      await processEventQueue();

      const dm = DataManager.getInstance();
      const archived = await dm.getAllInCollection<Record<string, unknown>>(ARCHIVED_EVENTS);
      const found = archived.find(e => e['eventType'] === 'ARCHIVE_EVENT');

      expect(found).toBeDefined();
    });

    it('queue is empty after processEventQueue completes', async () => {
      await JustInEngine.init();
      await UserManager.createUser({ uniqueIdentifier: 'carol', attributes: {} });

      registerTestTask({ name: 'drainTask' });
      await EventHandlerManager.getInstance().registerEventHandlers('DRAIN_EVENT', ['drainTask']);

      await publishEvent('DRAIN_EVENT', new Date());
      await processEventQueue();

      expect(await queueIsEmpty()).toBe(true);
    });

    it('processes multiple events in the queue sequentially', async () => {
      await JustInEngine.init();
      await UserManager.createUser({ uniqueIdentifier: 'dave', attributes: {} });

      const processed: string[] = [];
      registerTestTask({
        name: 'multiTask',
        shouldActivate: async () => ({ status: 'success' }),
        doAction: async (_user, event) => {
          processed.push(event.eventType);
          return { status: 'success' };
        },
      });

      await EventHandlerManager.getInstance().registerEventHandlers('MULTI_A', ['multiTask']);
      await EventHandlerManager.getInstance().registerEventHandlers('MULTI_B', ['multiTask'], true);

      await publishEvent('MULTI_A', new Date());
      await publishEvent('MULTI_B', new Date());
      await processEventQueue();

      expect(processed).toHaveLength(2);
      expect(processed).toEqual(expect.arrayContaining(['MULTI_A', 'MULTI_B']));
    });
  });

  describe('decision rule — full execution via queue', () => {
    it('runs all three steps when shouldActivate and selectAction succeed', async () => {
      await JustInEngine.init();
      await UserManager.createUser({ uniqueIdentifier: 'eve', attributes: {} });

      const steps: string[] = [];

      registerTestDecisionRule({
        name: 'stepTrackingRule',
        shouldActivate: async () => { steps.push('shouldActivate'); return { status: 'success' }; },
        selectAction: async () => { steps.push('selectAction'); return { status: 'success' }; },
        doAction: async () => { steps.push('doAction'); return { status: 'success' }; },
      });

      await EventHandlerManager.getInstance().registerEventHandlers('STEP_EVENT', ['stepTrackingRule']);
      await publishEvent('STEP_EVENT', new Date());
      await processEventQueue();

      expect(steps).toEqual(['shouldActivate', 'selectAction', 'doAction']);
    });

    it('skips doAction when shouldActivate returns stop', async () => {
      await JustInEngine.init();
      await UserManager.createUser({ uniqueIdentifier: 'frank', attributes: {} });

      const steps: string[] = [];

      registerTestDecisionRule({
        name: 'stopRule',
        shouldActivate: async () => { steps.push('shouldActivate'); return { status: 'stop' }; },
        selectAction: async () => { steps.push('selectAction'); return { status: 'success' }; },
        doAction: async () => { steps.push('doAction'); return { status: 'success' }; },
      });

      await EventHandlerManager.getInstance().registerEventHandlers('STOP_EVENT', ['stopRule']);
      await publishEvent('STOP_EVENT', new Date());
      await processEventQueue();

      expect(steps).toEqual(['shouldActivate']);
    });
  });

  describe('multiple users', () => {
    it('runs the handler for every user independently', async () => {
      await JustInEngine.init();

      await UserManager.createUser({ uniqueIdentifier: 'u1', attributes: {} });
      await UserManager.createUser({ uniqueIdentifier: 'u2', attributes: {} });
      await UserManager.createUser({ uniqueIdentifier: 'u3', attributes: {} });

      const executedFor: string[] = [];
      registerTestTask({
        name: 'multiUserTask',
        shouldActivate: async () => ({ status: 'success' }),
        doAction: async (user) => {
          executedFor.push(user.uniqueIdentifier);
          return { status: 'success' };
        },
      });

      await EventHandlerManager.getInstance().registerEventHandlers('MULTI_USER_EVENT', ['multiUserTask']);
      await publishEvent('MULTI_USER_EVENT', new Date());
      await processEventQueue();

      expect(executedFor).toHaveLength(3);
      expect(executedFor).toEqual(expect.arrayContaining(['u1', 'u2', 'u3']));
    });
  });

  describe('task + decision rule pipeline ordering', () => {
    it('task completes its full user sweep before decision rule starts', async () => {
      await JustInEngine.init();

      await UserManager.createUser({ uniqueIdentifier: 'g1', attributes: {} });
      await UserManager.createUser({ uniqueIdentifier: 'g2', attributes: {} });

      const log: string[] = [];

      registerTestTask({
        name: 'fetchTask',
        shouldActivate: async () => ({ status: 'success' }),
        doAction: async (user) => { log.push(`fetch:${user.uniqueIdentifier}`); return { status: 'success' }; },
      });

      registerTestDecisionRule({
        name: 'decideRule',
        shouldActivate: async () => ({ status: 'success' }),
        selectAction: async () => ({ status: 'success' }),
        doAction: async (user) => { log.push(`decide:${user.uniqueIdentifier}`); return { status: 'success' }; },
      });

      await EventHandlerManager.getInstance().registerEventHandlers('PIPELINE_EVENT', ['fetchTask', 'decideRule']);
      await publishEvent('PIPELINE_EVENT', new Date());
      await processEventQueue();

      const fetchIndices = log.flatMap((e, i) => e.startsWith('fetch') ? [i] : []);
      const decideIndices = log.flatMap((e, i) => e.startsWith('decide') ? [i] : []);

      expect(Math.max(...fetchIndices)).toBeLessThan(Math.min(...decideIndices));
    });
  });

  describe('beforeExecution / afterExecution hooks', () => {
    it('calls beforeExecution once before any user and afterExecution once after all users', async () => {
      await JustInEngine.init();

      await UserManager.createUser({ uniqueIdentifier: 'h1', attributes: {} });
      await UserManager.createUser({ uniqueIdentifier: 'h2', attributes: {} });

      let beforeCount = 0;
      let afterCount = 0;
      const userLog: string[] = [];

      registerTestTask({
        name: 'lifecycleTask',
        beforeExecution: async () => { beforeCount++; },
        shouldActivate: async () => ({ status: 'success' }),
        doAction: async (user) => { userLog.push(user.uniqueIdentifier); return { status: 'success' }; },
        afterExecution: async () => { afterCount++; },
      });

      await EventHandlerManager.getInstance().registerEventHandlers('LIFECYCLE_EVENT', ['lifecycleTask']);
      await publishEvent('LIFECYCLE_EVENT', new Date());
      await processEventQueue();

      expect(beforeCount).toBe(1);
      expect(afterCount).toBe(1);
      expect(userLog).toHaveLength(2);
    });
  });
});
