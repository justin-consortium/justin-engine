import { makeNewUserRecord, makeUser } from '@just-in/core/testing';
import { makeEngineSandbox } from '../testing';

import { JustInLite } from '../JustInLite';
import { EventHandlerManager } from '../event/event-handler-manager';

import * as EventExecutor from '../event/event-executor';
import * as ResultRecorder from '../handlers/result-recorder';

import type { JUser, NewUserRecord } from '@just-in/core';

describe('JustInLite', () => {
  const engineSandbox = makeEngineSandbox();

  let justin: ReturnType<typeof JustInLite>;
  let ehm: EventHandlerManager;

  beforeEach(async () => {
    // Arrange
    await engineSandbox.reset();
    justin = JustInLite();
    ehm = EventHandlerManager.getInstance();
  });

  afterEach(async () => {
    await engineSandbox.restore();
  });

  describe('Users (in-memory)', () => {
    it('accepts NewUserRecord[] and normalizes to JUser[]', async () => {
      // Arrange
      const input: NewUserRecord[] = [
        makeNewUserRecord({ uniqueIdentifier: 'u1', initialAttributes: { a: 1 } }),
        makeNewUserRecord({ uniqueIdentifier: 'u2', initialAttributes: { b: 2 } }),
      ];

      // Act
      const result = await justin.loadUsers(input);

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'u1',
        uniqueIdentifier: 'u1',
        attributes: { a: 1 },
      });
      expect(result[1]).toEqual({
        id: 'u2',
        uniqueIdentifier: 'u2',
        attributes: { b: 2 },
      });
    });

    it('accepts JUser[] and replaces in-memory set atomically', async () => {
      // Arrange
      const first: JUser[] = [
        makeUser({ id: 'a', uniqueIdentifier: 'a', attributes: { foo: 1 } }) as unknown as JUser,
      ];
      const second: JUser[] = [
        makeUser({ id: 'b', uniqueIdentifier: 'b', attributes: { bar: 2 } }) as unknown as JUser,
      ];

      await justin.loadUsers(first);
      await justin.loadUsers(second);

      const regSpy = engineSandbox.sb.spy(ehm, 'registerEventHandlers');
      await justin.registerEventHandlers('EV', ['HandlerA']);

      const execStub = engineSandbox.sb.stub(EventExecutor, 'executeEventForUsers').resolves();

      // Act
      await justin.publishEvent('EV', new Date());

      // Assert
      expect(regSpy.calledOnce).toBe(true);
      expect(execStub.calledOnce).toBe(true);

      const usersPassed = execStub.firstCall.args[1] as JUser[];
      expect(usersPassed).toHaveLength(1);
      expect(usersPassed[0].uniqueIdentifier).toBe('b');
    });

    it('throws on missing uniqueIdentifier', async () => {
      // Arrange
      const bad: any[] = [{ id: 'x' }];

      // Act / Assert
      await expect(justin.loadUsers(bad as any)).rejects.toThrow(/uniqueIdentifier/i);
    });

    it('throws on duplicates within the same call', async () => {
      // Arrange
      const dup: NewUserRecord[] = [
        makeNewUserRecord({ uniqueIdentifier: 'z', initialAttributes: { name: 'test' } }),
        makeNewUserRecord({ uniqueIdentifier: 'z', initialAttributes: { name: 'test2' } }),
      ];

      // Act / Assert
      await expect(justin.loadUsers(dup)).rejects.toThrow(/duplicate/i);
    });
  });

  describe('Execution / publishEvent', () => {
    it('throws if no users loaded', async () => {
      // Arrange
      await justin.registerEventHandlers('EV', ['H']);

      // Act / Assert
      await expect(justin.publishEvent('EV', new Date())).rejects.toThrow(/no users/i);
    });

    it('throws if event type not registered', async () => {
      // Arrange
      await justin.loadUsers([
        makeUser({ id: 'u', uniqueIdentifier: 'u', attributes: {} }) as unknown as JUser,
      ]);

      // Act / Assert
      await expect(justin.publishEvent('MISSING', new Date())).rejects.toThrow(/no handlers/i);
    });

    it('builds event and calls shared executor once', async () => {
      // Arrange
      await justin.registerEventHandlers('EV', ['H']);
      await justin.loadUsers([
        makeUser({ id: 'u', uniqueIdentifier: 'u', attributes: {} }) as unknown as JUser,
      ]);

      const execStub = engineSandbox.sb.stub(EventExecutor, 'executeEventForUsers').resolves();

      const ts = new Date('2025-01-01T00:00:00Z');
      const details = { cloudEventId: '123' };

      // Act
      await justin.publishEvent('EV', ts, details);

      // Assert
      expect(execStub.calledOnce).toBe(true);

      const [eventArg, usersArg] = execStub.firstCall.args;
      expect(eventArg).toMatchObject({
        eventType: 'EV',
        generatedTimestamp: ts,
        eventDetails: details,
      });

      expect((usersArg as JUser[])[0].uniqueIdentifier).toBe('u');
    });

    it('idempotencyKey skips duplicate within same warm instance', async () => {
      // Arrange
      await justin.registerEventHandlers('EV', ['H']);
      await justin.loadUsers([
        makeUser({ id: 'u', uniqueIdentifier: 'u', attributes: {} }) as unknown as JUser,
      ]);

      const execStub = engineSandbox.sb.stub(EventExecutor, 'executeEventForUsers').resolves();

      // Act
      const key = 'k-1';
      await justin.publishEvent('EV', new Date(), {}, key);
      await justin.publishEvent('EV', new Date(), {}, key);

      // Assert
      expect(execStub.calledOnce).toBe(true);
    });
  });

  describe('Writers', () => {
    it('configureTaskResultWriter delegates to result-recorder', () => {
      // Arrange
      const taskStub = engineSandbox.sb.stub(ResultRecorder, 'setTaskResultRecorder');
      const fn = async () => {};

      // Act
      justin.configureTaskResultWriter(fn);

      // Assert
      expect(taskStub.calledOnceWithExactly(fn)).toBe(true);
    });

    it('configureDecisionRuleResultWriter delegates to result-recorder', () => {
      // Arrange
      const ruleStub = engineSandbox.sb.stub(ResultRecorder, 'setDecisionRuleResultRecorder');
      const fn = async () => {};

      // Act
      justin.configureDecisionRuleResultWriter(fn);

      // Assert
      expect(ruleStub.calledOnceWithExactly(fn)).toBe(true);
    });
  });
});
