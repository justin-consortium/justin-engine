import { makeEngineSandbox } from '../testing';

import { JustInWrapper } from '../JustInWrapper';
import {DataManager, UserManager, DBType} from '@just-in/core';
import { EventHandlerManager } from '../event/event-handler-manager';
import * as EventQueue from '../event/event-queue';
import * as TaskManager from '../handlers/task.manager';
import * as DecisionRuleManager from '../handlers/decision-rule.manager';

describe('JustInWrapper', () => {
  const engineSandbox = makeEngineSandbox();

  let wrapper: JustInWrapper;

  beforeEach(async () => {
    // Arrange
    await engineSandbox.reset();
    wrapper = JustInWrapper.getInstance();
  });

  afterEach(async () => {
    await engineSandbox.restore();
  });

  describe('getInstance', () => {
    it('returns the singleton instance', () => {
      // Arrange
      const a = JustInWrapper.getInstance();

      // Act
      const b = JustInWrapper.getInstance();

      // Assert
      expect(a).toBe(b);
      expect(a).toBeInstanceOf(JustInWrapper);
    });

    it('creates a new instance after killInstance', () => {
      // Arrange
      const old = JustInWrapper.getInstance();
      (JustInWrapper as any).killInstance();

      // Act
      const fresh = JustInWrapper.getInstance();

      // Assert
      expect(fresh).toBeInstanceOf(JustInWrapper);
      expect(fresh).not.toBe(old);
    });
  });

  describe('init', () => {
    it('initializes DataManager and UserManager once', async () => {
      // Arrange
      const dm = DataManager.getInstance();
      const dmInitStub = engineSandbox.sb.stub(dm, 'init').resolves();
      const umInitStub = engineSandbox.sb.stub(UserManager, 'init').resolves();

      // Act
      await wrapper.init();

      // Assert
      expect(dmInitStub.calledOnce).toBe(true);
      expect(dmInitStub.calledWith(DBType.MONGO)).toBe(true);
      expect(umInitStub.calledOnce).toBe(true);
    });

    it('does not reinitialize if already initialized', async () => {
      // Arrange
      const dm = DataManager.getInstance();
      const dmInitStub = engineSandbox.sb.stub(dm, 'init').resolves();
      const umInitStub = engineSandbox.sb.stub(UserManager, 'init').resolves();

      await wrapper.init();
      dmInitStub.resetHistory();
      umInitStub.resetHistory();

      // Act
      await wrapper.init();

      // Assert
      expect(dmInitStub.called).toBe(false);
      expect(umInitStub.called).toBe(false);
    });

    it('propagates init errors', async () => {
      // Arrange
      const dm = DataManager.getInstance();
      engineSandbox.sb.stub(UserManager, 'init').resolves();
      engineSandbox.sb.stub(dm, 'init').rejects(new Error('Database connection failed'));

      // Act / Assert
      await expect(wrapper.init()).rejects.toThrow('Database connection failed');
    });
  });

  describe('users', () => {
    it('addUsers delegates to UserManager.addUsers', async () => {
      // Arrange
      const addUsersStub = engineSandbox.sb.stub(UserManager, 'addUsers').resolves();
      const users = [
        { uniqueIdentifier: 'user1', initialAttributes: { name: 'User 1' } },
        { uniqueIdentifier: 'user2', initialAttributes: { name: 'User 2' } },
      ];

      // Act
      await wrapper.addUsers(users as any);

      // Assert
      expect(addUsersStub.calledOnceWithExactly(users as any)).toBe(true);
    });

    it('getAllUsers delegates to UserManager.getAllUsers', async () => {
      // Arrange
      const getAllStub = engineSandbox.sb.stub(UserManager, 'getAllUsers').resolves([]);

      // Act
      const out = await wrapper.getAllUsers();

      // Assert
      expect(getAllStub.calledOnce).toBe(true);
      expect(out).toEqual([]);
    });

    it('addUser delegates to UserManager.addUser', async () => {
      // Arrange
      const addUserStub = engineSandbox.sb.stub(UserManager, 'addUser').resolves();
      const user = { uniqueIdentifier: 'user1', initialAttributes: { name: 'User 1' } };

      // Act
      await wrapper.addUser(user as any);

      // Assert
      expect(addUserStub.calledOnceWithExactly(user as any)).toBe(true);
    });

    it('getUser delegates to UserManager.getUserByUniqueIdentifier', async () => {
      // Arrange
      const getStub = engineSandbox.sb.stub(UserManager, 'getUserByUniqueIdentifier').resolves(null as any);

      // Act
      await wrapper.getUser('user1');

      // Assert
      expect(getStub.calledOnceWithExactly('user1')).toBe(true);
    });

    it('updateUser delegates to UserManager.updateUserByUniqueIdentifier', async () => {
      // Arrange
      const updateStub = engineSandbox.sb
        .stub(UserManager, 'updateUserByUniqueIdentifier')
        .resolves(null as any);

      // Act
      await wrapper.updateUser('user1', { name: 'New Name' } as any);

      // Assert
      expect(updateStub.calledOnceWithExactly('user1', { name: 'New Name' } as any)).toBe(true);
    });

    it('deleteUser delegates to UserManager.deleteUserByUniqueIdentifier', async () => {
      // Arrange
      const delStub = engineSandbox.sb.stub(UserManager, 'deleteUserByUniqueIdentifier').resolves();

      // Act
      await wrapper.deleteUser('user1');

      // Assert
      expect(delStub.calledOnceWithExactly('user1')).toBe(true);
    });
  });

  describe('event handlers', () => {
    it('registerEventHandlers delegates to EventHandlerManager.registerEventHandlers', async () => {
      // Arrange
      const mgr = EventHandlerManager.getInstance();
      const regStub = engineSandbox.sb.stub(mgr, 'registerEventHandlers').resolves();

      // Act
      await wrapper.registerEventHandlers('TEST_EVENT', ['task1', 'rule1']);

      // Assert
      expect(regStub.calledOnceWithExactly('TEST_EVENT', ['task1', 'rule1'])).toBe(true);
    });

    it('unregisterEventHandlers delegates to EventHandlerManager.unregisterEventHandlers', () => {
      // Arrange
      const mgr = EventHandlerManager.getInstance();
      const unregStub = engineSandbox.sb.stub(mgr, 'unregisterEventHandlers').returns();

      // Act
      wrapper.unregisterEventHandlers('TEST_EVENT');

      // Assert
      expect(unregStub.calledOnceWithExactly('TEST_EVENT')).toBe(true);
    });
  });

  describe('publishEvent', () => {
    it('delegates to EventQueue.publishEvent', async () => {
      // Arrange
      const publishStub = engineSandbox.sb.stub(EventQueue, 'publishEvent').resolves();
      const ts = new Date();
      const details = { test: 'data' };

      // Act
      await wrapper.publishEvent('TEST_EVENT', ts, details);

      // Assert
      expect(publishStub.calledOnceWithExactly('TEST_EVENT', ts, details)).toBe(true);
    });

    it('delegates to EventQueue.publishEvent with undefined details', async () => {
      // Arrange
      const publishStub = engineSandbox.sb.stub(EventQueue, 'publishEvent').resolves();
      const ts = new Date();

      // Act
      await wrapper.publishEvent('TEST_EVENT', ts);

      // Assert
      expect(publishStub.calledOnceWithExactly('TEST_EVENT', ts, undefined)).toBe(true);
    });
  });

  describe('registrations', () => {
    it('registerTask delegates to TaskManager.registerTask', () => {
      // Arrange
      const regStub = engineSandbox.sb.stub(TaskManager, 'registerTask').returns();
      const task = {
        name: 'task1',
        beforeExecution: () => {},
        shouldActivate: () => ({ status: 'success' }),
        doAction: () => ({ status: 'success' }),
        afterExecution: () => {},
      };

      // Act
      wrapper.registerTask(task as any);

      // Assert
      expect(regStub.calledOnceWithExactly(task as any)).toBe(true);
    });

    it('registerDecisionRule delegates to DecisionRuleManager.registerDecisionRule', () => {
      // Arrange
      const regStub = engineSandbox.sb.stub(DecisionRuleManager, 'registerDecisionRule').returns();
      const rule = {
        name: 'rule1',
        beforeExecution: () => {},
        shouldActivate: () => ({ status: 'success' }),
        selectAction: () => ({ status: 'success' }),
        doAction: () => ({ status: 'success' }),
        afterExecution: () => {},
      };

      // Act
      wrapper.registerDecisionRule(rule as any);

      // Assert
      expect(regStub.calledOnceWithExactly(rule as any)).toBe(true);
    });
  });

  describe('engine lifecycle', () => {
    it('startEngine starts queue processing and kicks processing loop', async () => {
      // Arrange
      engineSandbox.sb.stub(EventQueue, 'startEventQueueProcessing').resolves();
      const processStub = engineSandbox.sb.stub(EventQueue, 'processEventQueue').resolves();

      const dm = DataManager.getInstance();
      engineSandbox.sb.stub(dm, 'init').resolves();
      engineSandbox.sb.stub(UserManager, 'init').resolves();

      await wrapper.init();

      // Act
      await wrapper.startEngine();

      // Assert
      expect(processStub.calledOnce).toBe(true);
    });

    it('shutdown stops queue processing, shuts down UserManager, and closes DataManager', async () => {
      // Arrange
      const dm = DataManager.getInstance();
      const dmInitStub = engineSandbox.sb.stub(dm, 'init').resolves();
      const dmCloseStub = engineSandbox.sb.stub(dm, 'close').resolves();

      const umInitStub = engineSandbox.sb.stub(UserManager, 'init').resolves();
      const umShutdownStub = engineSandbox.sb.stub(UserManager, 'shutdown').resolves();

      const stopStub = engineSandbox.sb.stub(EventQueue, 'stopEventQueueProcessing').resolves();
      engineSandbox.sb.stub(EventQueue, 'startEventQueueProcessing').resolves();
      engineSandbox.sb.stub(EventQueue, 'processEventQueue').resolves();

      await wrapper.init();
      expect(dmInitStub.calledOnce).toBe(true);
      expect(umInitStub.calledOnce).toBe(true);

      await wrapper.startEngine();

      // Act
      await wrapper.shutdown();

      // Assert
      expect(stopStub.calledOnce).toBe(true);
      expect(umShutdownStub.calledOnce).toBe(true);
      expect(dmCloseStub.calledOnce).toBe(true);

      const map = (wrapper as any).intervalTimerEventGenerators as Map<string, any>;
      expect(map.size).toBe(0);
    });
  });

  describe('JustIn()', () => {
    it('returns the singleton wrapper instance', () => {
      // Arrange
      const mod = require('../JustInWrapper') as { JustIn: () => JustInWrapper };

      // Act
      const inst = mod.JustIn();

      // Assert
      expect(inst).toBe(JustInWrapper.getInstance());
    });
  });
});
