import sinon from 'sinon';
import type { EngineSandbox } from '../../testing';
import { makeEngineSandbox, makeEvent, makeEngineTestUser } from '../../testing';
import { makeCoreManagersSandbox } from '@just-in/core/testing';
import type { CoreManagersSandbox } from '@just-in/core/testing';
import { DataManager, ChangeListenerManager } from '@just-in/core';
import * as CoreModule from '@just-in/core';
import { EventHandlerManager } from '../manager';
import {
  publishEvent,
  processEventQueue,
  setupEventQueueListener,
  startEventQueueProcessing,
  stopEventQueueProcessing,
  isRunning,
  _setShouldProcessQueue,
} from '../queue';
import * as Executor from '../executor';
import { EVENT_QUEUE, ARCHIVED_EVENTS } from '../../constants';

describe('event/queue — unit test', () => {
  let engineSandbox: EngineSandbox;
  let coreSandbox: CoreManagersSandbox;
  let dm: sinon.SinonStubbedInstance<ReturnType<typeof DataManager.getInstance>>;
  let clm: sinon.SinonStubbedInstance<ChangeListenerManager>;
  let executeEventForUsersStub: sinon.SinonStub;
  let mgr: EventHandlerManager;

  beforeEach(async () => {
    engineSandbox = makeEngineSandbox();
    coreSandbox = makeCoreManagersSandbox();
    dm = coreSandbox.dm as sinon.SinonStubbedInstance<ReturnType<typeof DataManager.getInstance>>;
    clm = coreSandbox.clm as sinon.SinonStubbedInstance<ChangeListenerManager>;
    mgr = EventHandlerManager.getInstance();

    executeEventForUsersStub = engineSandbox.sb.stub(Executor, 'executeEventForUsers').resolves();
    engineSandbox.sb.stub(CoreModule.UserManager, 'getAllUsers').returns([makeEngineTestUser()]);

    _setShouldProcessQueue(true);
  });

  afterEach(() => {
    coreSandbox.restore();
    engineSandbox.restore();
  });

  describe('publishEvent', () => {
    it('inserts an event into event_queue when handlers are registered', async () => {
      await mgr.registerEventHandlers('PUB_EV', ['h1']);
      dm.addItemToCollection.resolves({ ok: true, successes: [{ id: 'evt-1' }] } as any);

      await publishEvent('PUB_EV', new Date());

      expect(dm.addItemToCollection.callCount).toBeGreaterThan(0);
      const [collection, inserted] = dm.addItemToCollection.firstCall.args as [string, Record<string, unknown>];
      expect(collection).toBe(EVENT_QUEUE);
      expect(inserted['eventType']).toBe('PUB_EV');
    });

    it('stamps publishedTimestamp on the queued event', async () => {
      await mgr.registerEventHandlers('PUB_EV', ['h1']);
      dm.addItemToCollection.resolves({ ok: true, successes: [{ id: 'evt-1' }] } as any);

      const before = new Date();
      await publishEvent('PUB_EV', new Date());
      const after = new Date();

      const [, inserted] = dm.addItemToCollection.firstCall.args as [string, Record<string, unknown>];
      const published = inserted['publishedTimestamp'] as Date;
      expect(published.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(published.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('forwards eventDetails to the queued event', async () => {
      await mgr.registerEventHandlers('PUB_EV', ['h1']);
      dm.addItemToCollection.resolves({ ok: true, successes: [{ id: 'evt-1' }] } as any);

      await publishEvent('PUB_EV', new Date(), { trigger: 'test', score: 42 });

      const [, inserted] = dm.addItemToCollection.firstCall.args as [string, Record<string, unknown>];
      expect(inserted['eventDetails']).toEqual({ trigger: 'test', score: 42 });
    });

    it('skips publication when no handlers are registered', async () => {
      await publishEvent('NO_HANDLERS', new Date());
      sinon.assert.notCalled(dm.addItemToCollection);
    });

    it('throws when DataManager returns non-ok', async () => {
      await mgr.registerEventHandlers('FAIL_EV', ['h1']);
      dm.addItemToCollection.resolves({ ok: false, successes: [], failures: [{ code: 'DB_ERROR', reason: 'insert failed' }] } as any);

      await expect(publishEvent('FAIL_EV', new Date())).rejects.toThrow('DataManager failure');
    });

    it('throws when DataManager throws', async () => {
      await mgr.registerEventHandlers('FAIL_EV', ['h1']);
      dm.addItemToCollection.rejects(new Error('db down'));

      await expect(publishEvent('FAIL_EV', new Date())).rejects.toThrow('db down');
    });

    it('logs an error before rethrowing', async () => {
      await mgr.registerEventHandlers('FAIL_EV', ['h1']);
      dm.addItemToCollection.rejects(new Error('db down'));

      await expect(publishEvent('FAIL_EV', new Date())).rejects.toThrow();

      const errorLogs = engineSandbox.logs.findByMessage('Failed to publish event');
      expect(errorLogs).toHaveLength(1);
      expect(errorLogs[0].entry.severity).toBe('ERROR');
    });
  });

  describe('processEventQueue', () => {
    it('fetches events and executes them against users', async () => {
      const event = makeEvent({ id: 'ev-1', eventType: 'RUN_EV' });
      dm.getAllInCollection.onFirstCall().resolves([event]).onSecondCall().resolves([]);
      dm.addItemToCollection.resolves({ ok: true, successes: [{ id: 'arc-1' }] } as any);
      dm.removeItemFromCollection.resolves(1 as any);

      await processEventQueue();

      expect(executeEventForUsersStub.calledOnce).toBe(true);
      expect(executeEventForUsersStub.firstCall.args[0]).toEqual(event);
    });

    it('archives each event after processing', async () => {
      const event = makeEvent({ id: 'ev-1', eventType: 'RUN_EV' });
      dm.getAllInCollection.onFirstCall().resolves([event]).onSecondCall().resolves([]);
      dm.addItemToCollection.resolves({ ok: true, successes: [{ id: 'arc-1' }] } as any);
      dm.removeItemFromCollection.resolves(1 as any);

      await processEventQueue();

      const archiveCall = dm.addItemToCollection.getCalls().find(c => c.args[0] === ARCHIVED_EVENTS);
      expect(archiveCall).toBeDefined();
      const [collection, eventId] = dm.removeItemFromCollection.firstCall.args as [string, string];
      expect(collection).toBe(EVENT_QUEUE);
      expect(eventId).toBe('ev-1');
    });

    it('does nothing when the queue is empty', async () => {
      dm.getAllInCollection.resolves([]);

      await processEventQueue();

      expect(executeEventForUsersStub.called).toBe(false);
    });

    it('is re-entrant safe — second call returns immediately if processing is in flight', async () => {
      let resolveFirst!: () => void;
      const firstProcessing = new Promise<void>(r => { resolveFirst = r; });
      dm.getAllInCollection.onFirstCall().returns(firstProcessing.then(() => []));

      const p1 = processEventQueue();
      const p2 = processEventQueue();
      resolveFirst();
      await Promise.all([p1, p2]);

      expect(dm.getAllInCollection.callCount).toBe(1);
    });

    it('does not execute events when _shouldProcessQueue is false', async () => {
      _setShouldProcessQueue(false);
      dm.getAllInCollection.resolves([makeEvent({ id: 'ev-x' })]);

      await processEventQueue();

      expect(executeEventForUsersStub.called).toBe(false);
    });

    it('continues processing remaining events when archive fails', async () => {
      const event1 = makeEvent({ id: 'ev-1', eventType: 'EV' });
      const event2 = makeEvent({ id: 'ev-2', eventType: 'EV' });

      dm.getAllInCollection.onFirstCall().resolves([event1, event2]).onSecondCall().resolves([]);
      dm.addItemToCollection
        .onFirstCall().resolves({ ok: false, successes: [], failures: [{ code: 'DB_ERROR', reason: 'fail' }] } as any)
        .resolves({ ok: true, successes: [{ id: 'x' }] } as any);
      dm.removeItemFromCollection.resolves(1 as any);

      await processEventQueue();

      expect(executeEventForUsersStub.callCount).toBe(2);
    });
  });

  describe('stopEventQueueProcessing', () => {
    it('sets isRunning to false', () => {
      stopEventQueueProcessing();
      expect(isRunning()).toBe(false);
    });

    it('removes the change listener', () => {
      stopEventQueueProcessing();
      expect(clm.removeChangeListener.callCount).toBeGreaterThan(0);
      const [collection] = clm.removeChangeListener.firstCall.args as [string, string];
      expect(collection).toBe(EVENT_QUEUE);
    });
  });

  describe('setupEventQueueListener', () => {
    it('adds a change listener on event_queue INSERT', async () => {
      dm.getAllInCollection.resolves([]);
      coreSandbox.clm.hasChangeListener = engineSandbox.sb.stub().returns(false);

      await setupEventQueueListener();

      expect(clm.addChangeListener.callCount).toBeGreaterThan(0);
      const [collection, , callback] = clm.addChangeListener.firstCall.args as [string, unknown, unknown];
      expect(collection).toBe(EVENT_QUEUE);
      expect(typeof callback).toBe('function');
    });

    it('kicks off an initial drain on setup', async () => {
      dm.getAllInCollection.resolves([]);
      coreSandbox.clm.hasChangeListener = engineSandbox.sb.stub().returns(false);

      await setupEventQueueListener();

      expect(dm.getAllInCollection.callCount).toBeGreaterThan(0);
      expect(dm.getAllInCollection.firstCall.args[0]).toBe(EVENT_QUEUE);
    });

    it('is idempotent — skips setup if listener already exists', async () => {
      dm.getAllInCollection.resolves([]);
      coreSandbox.clm.hasChangeListener = engineSandbox.sb.stub().returns(true);

      await setupEventQueueListener();

      sinon.assert.notCalled(clm.addChangeListener);
    });
  });

  describe('startEventQueueProcessing', () => {
    it('sets isRunning to true and wires the listener', async () => {
      _setShouldProcessQueue(false);
      dm.getAllInCollection.resolves([]);
      coreSandbox.clm.hasChangeListener = engineSandbox.sb.stub().returns(false);

      await startEventQueueProcessing();

      expect(isRunning()).toBe(true);
    });
  });
});
