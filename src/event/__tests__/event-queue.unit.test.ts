import sinon from 'sinon';
import { makeUser } from '@just-in/core/testing';
import { makeEngineSandbox } from '../../testing';
import * as EventQueue from '../event-queue';
import { EventHandlerManager } from '../event-handler-manager';
import {DataManager, ChangeListenerManager, UserManager, CollectionChangeType} from '@just-in/core';
import * as EventExecutor from '../event-executor';
import type { JEvent } from '../event.type';
import type { JUser } from '@just-in/core';

describe('EventQueue', () => {
  const engineSandbox = makeEngineSandbox();

  let eventHandlerManager: EventHandlerManager;
  let dataManager: DataManager;
  let changeListenerManager: ChangeListenerManager;

  let hasHandlersForEventTypeStub: sinon.SinonStub;
  let getHandlersForEventTypeStub: sinon.SinonStub;

  let addItemToCollectionStub: sinon.SinonStub;
  let getAllInCollectionStub: sinon.SinonStub;
  let removeItemFromCollectionStub: sinon.SinonStub;

  let addChangeListenerStub: sinon.SinonStub;
  let removeChangeListenerStub: sinon.SinonStub;

  let getAllUsersStub: sinon.SinonStub;

  let executeEventForUsersStub: sinon.SinonStub;

  beforeEach(async () => {
    await engineSandbox.reset();

    eventHandlerManager = EventHandlerManager.getInstance();
    dataManager = DataManager.getInstance();
    changeListenerManager = ChangeListenerManager.getInstance();

    hasHandlersForEventTypeStub = engineSandbox.sb.stub(
      eventHandlerManager,
      'hasHandlersForEventType',
    );
    getHandlersForEventTypeStub = engineSandbox.sb.stub(
      eventHandlerManager,
      'getHandlersForEventType',
    );

    addItemToCollectionStub = engineSandbox.sb.stub(dataManager, 'addItemToCollection');
    getAllInCollectionStub = engineSandbox.sb.stub(dataManager, 'getAllInCollection');
    removeItemFromCollectionStub = engineSandbox.sb.stub(dataManager, 'removeItemFromCollection');

    addChangeListenerStub = engineSandbox.sb.stub(changeListenerManager, 'addChangeListener');
    removeChangeListenerStub = engineSandbox.sb.stub(
      changeListenerManager,
      'removeChangeListener',
    );

    getAllUsersStub = engineSandbox.sb.stub(UserManager, 'getAllUsers');

    executeEventForUsersStub = engineSandbox.sb
      .stub(EventExecutor, 'executeEventForUsers')
      .resolves();

    EventQueue.setShouldProcessQueue(true);
  });

  afterEach(async () => {
    await engineSandbox.restore();
  });

  describe('publishEvent', () => {
    it('publishes event successfully when handlers exist', async () => {
      // Arrange
      const eventType = 'TEST_EVENT';
      const timestamp = new Date();
      const eventDetails = { test: 'data' };

      hasHandlersForEventTypeStub.returns(true);
      addItemToCollectionStub.resolves({ id: 'event1' } as JEvent);

      // Act
      await EventQueue.publishEvent(eventType, timestamp, eventDetails);

      // Assert
      expect(hasHandlersForEventTypeStub.calledOnceWithExactly(eventType)).toBe(true);
      expect(addItemToCollectionStub.calledOnce).toBe(true);

      const addedEvent = addItemToCollectionStub.firstCall.args[1] as JEvent;
      expect(addedEvent.eventType).toBe(eventType);
      expect(addedEvent.generatedTimestamp).toBe(timestamp);
      expect(addedEvent.eventDetails).toBe(eventDetails);
    });

    it('skips publication when no handlers exist', async () => {
      // Arrange
      const eventType = 'TEST_EVENT';
      const timestamp = new Date();

      hasHandlersForEventTypeStub.returns(false);

      // Act
      await EventQueue.publishEvent(eventType, timestamp);

      // Assert
      expect(hasHandlersForEventTypeStub.calledOnceWithExactly(eventType)).toBe(true);
      expect(addItemToCollectionStub.called).toBe(false);
    });

    it('propagates errors during publication', async () => {
      // Arrange
      const eventType = 'TEST_EVENT';
      const timestamp = new Date();

      hasHandlersForEventTypeStub.returns(true);
      addItemToCollectionStub.rejects(new Error('Database error'));

      // Act / Assert
      await expect(EventQueue.publishEvent(eventType, timestamp)).rejects.toThrow(
        'Database error',
      );
    });
  });

  describe('processEventQueue', () => {
    it('processes events: executes, archives, then removes from queue', async () => {
      // Arrange
      const users: JUser[] = [
        makeUser({
          id: 'user1',
          uniqueIdentifier: 'user1-unique',
          attributes: { name: 'User 1' },
        }) as unknown as JUser,
        makeUser({
          id: 'user2',
          uniqueIdentifier: 'user2-unique',
          attributes: { name: 'User 2' },
        }) as unknown as JUser,
      ];

      const event: JEvent = {
        id: 'event1',
        eventType: 'TEST_EVENT',
        generatedTimestamp: new Date(),
      } as JEvent;

      getAllUsersStub.returns(users);
      getAllInCollectionStub.onFirstCall().resolves([event]);
      getAllInCollectionStub.onSecondCall().resolves([]);

      getHandlersForEventTypeStub.returns(['handler1']);

      addItemToCollectionStub.resolves();
      removeItemFromCollectionStub.resolves();

      // Act
      await EventQueue.processEventQueue();

      // Assert
      expect(executeEventForUsersStub.calledOnce).toBe(true);

      const [passedEvent, passedUsers, passedMgr] = executeEventForUsersStub.firstCall
        .args as [JEvent, JUser[], EventHandlerManager];

      expect(passedEvent).toBe(event);
      expect(passedUsers).toBe(users);
      expect(passedMgr).toBe(eventHandlerManager);

      expect(addItemToCollectionStub.calledWith('archived_events', event)).toBe(true);
      expect(removeItemFromCollectionStub.calledWith('event_queue', 'event1')).toBe(true);
    });

    it('skips processing when queue is empty', async () => {
      // Arrange
      getAllUsersStub.returns([]);
      getAllInCollectionStub.resolves([]);

      // Act
      await EventQueue.processEventQueue();

      // Assert
      expect(getAllInCollectionStub.calledOnceWithExactly('event_queue')).toBe(true);
      expect(executeEventForUsersStub.called).toBe(false);
      expect(addItemToCollectionStub.called).toBe(false);
      expect(removeItemFromCollectionStub.called).toBe(false);
    });

    it('skips processing when already in progress', async () => {
      // Arrange
      const deferred = (() => {
        let resolve!: (value: unknown) => void;
        const promise = new Promise((r) => {
          resolve = r;
        });
        return { promise, resolve };
      })();

      getAllUsersStub.returns([]);
      getAllInCollectionStub.returns(deferred.promise);

      // Act
      const p1 = EventQueue.processEventQueue();
      const p2 = EventQueue.processEventQueue();

      // Assert
      expect(getAllInCollectionStub.calledOnce).toBe(true);

      deferred.resolve([]);
      await Promise.all([p1, p2]);
    });

    it('does not remove from queue when archiving fails', async () => {
      // Arrange
      const users: JUser[] = [
        makeUser({
          id: 'user1',
          uniqueIdentifier: 'user1-unique',
          attributes: { name: 'User 1' },
        }) as unknown as JUser,
      ];

      const event: JEvent = {
        id: 'event1',
        eventType: 'TEST_EVENT',
        generatedTimestamp: new Date(),
      } as JEvent;

      getAllUsersStub.returns(users);
      getAllInCollectionStub.onFirstCall().resolves([event]);
      getAllInCollectionStub.onSecondCall().resolves([]);

      getHandlersForEventTypeStub.returns(['handler1']);

      addItemToCollectionStub.rejects(new Error('Archive error'));

      // Act
      await EventQueue.processEventQueue();

      // Assert
      expect(removeItemFromCollectionStub.called).toBe(false);
    });

    it('skips archiving and removal when event has no ID', async () => {
      // Arrange
      const event: JEvent = {
        eventType: 'TEST_EVENT',
        generatedTimestamp: new Date(),
      } as JEvent;

      getAllUsersStub.returns([]);
      getAllInCollectionStub.onFirstCall().resolves([event]);
      getAllInCollectionStub.onSecondCall().resolves([]);

      getHandlersForEventTypeStub.returns([]);

      addItemToCollectionStub.resolves();
      removeItemFromCollectionStub.resolves();

      // Act
      await EventQueue.processEventQueue();

      // Assert
      expect(addItemToCollectionStub.calledWith('archived_events', event)).toBe(false);
      expect(removeItemFromCollectionStub.called).toBe(false);
    });

  });

  describe('setupEventQueueListener', () => {
    it('sets up listener', async () => {
      // Arrange
      getAllInCollectionStub.resolves([]);

      // Act
      await EventQueue.setupEventQueueListener();

      // Assert
      expect(addChangeListenerStub.calledOnce).toBe(true);
      expect(addChangeListenerStub.firstCall.args[0]).toBe('event_queue');
      expect(addChangeListenerStub.firstCall.args[1]).toBe(CollectionChangeType.INSERT);
    });
  });

  describe('stopEventQueueProcessing', () => {
    it('stops queue processing', () => {
      // Arrange

      // Act
      EventQueue.stopEventQueueProcessing();

      // Assert
      expect(removeChangeListenerStub.calledOnce).toBe(true);
      expect(removeChangeListenerStub.firstCall.args[0]).toBe('event_queue');
      expect(removeChangeListenerStub.firstCall.args[1]).toBe(CollectionChangeType.INSERT);
    });
  });

  describe('startEventQueueProcessing', () => {
    it('starts queue processing', async () => {
      // Arrange
      EventQueue.setShouldProcessQueue(false);

      // Act
      await EventQueue.startEventQueueProcessing();

      // Assert
      expect(EventQueue.isRunning()).toBe(true);
    });
  });

  describe('isRunning', () => {
    it('returns true when queue is running', async () => {
      // Arrange
      EventQueue.setShouldProcessQueue(false);

      // Act
      await EventQueue.startEventQueueProcessing();

      // Assert
      expect(EventQueue.isRunning()).toBe(true);
    });

    it('returns false when queue is stopped', () => {
      // Arrange

      // Act
      EventQueue.stopEventQueueProcessing();

      // Assert
      expect(EventQueue.isRunning()).toBe(false);
    });
  });

  describe('queueIsEmpty', () => {
    it('returns true when queue is empty', async () => {
      // Arrange
      getAllInCollectionStub.resolves([]);

      // Act
      const isEmpty = await EventQueue.queueIsEmpty();

      // Assert
      expect(isEmpty).toBe(true);
      expect(getAllInCollectionStub.calledOnceWithExactly('event_queue')).toBe(true);
    });

    it('returns false when queue has events', async () => {
      // Arrange
      getAllInCollectionStub.resolves([{ id: 'event1' }]);

      // Act
      const isEmpty = await EventQueue.queueIsEmpty();

      // Assert
      expect(isEmpty).toBe(false);
    });

    it('treats null/undefined as empty', async () => {
      // Arrange
      getAllInCollectionStub.resolves(null);

      // Act
      const isEmpty = await EventQueue.queueIsEmpty();

      // Assert
      expect(isEmpty).toBe(true);
    });
  });
});
