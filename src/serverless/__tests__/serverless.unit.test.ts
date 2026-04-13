import sinon from 'sinon';
import type { EngineSandbox } from '../../testing';
import { makeEngineSandbox, makeEngineTestUser } from '../../testing';
import { JustInServerless, _resetServerless } from '../serverless';
import { EventHandlerManager } from '../../event/manager';
import * as Executor from '../../event/executor';
import type { JUser } from '@just-in/core';
import type { ServerlessUserInput } from '../types';

describe('serverless/serverless — unit test', () => {
  let engineSandbox: EngineSandbox;
  let executeEventForUsersStub: sinon.SinonStub;

  beforeEach(() => {
    engineSandbox = makeEngineSandbox();
    _resetServerless();
    executeEventForUsersStub = engineSandbox.sb.stub(Executor, 'executeEventForUsers').resolves();
  });

  afterEach(() => engineSandbox.restore());

  describe('loadUsers — NewUserRecord inputs', () => {
    it('normalises a NewUserRecord and returns a JUser array', async () => {
      const result = await JustInServerless.loadUsers([{ uniqueIdentifier: 'alice', attributes: { age: 30 } }]);
      expect(result).toHaveLength(1);
      expect(result[0].uniqueIdentifier).toBe('alice');
    });

    it('keeps attributes nested — does not flatten onto the user', async () => {
      const result = await JustInServerless.loadUsers([{
        uniqueIdentifier: 'alice',
        attributes: { demographics: { timeZone: 'America/New_York' } },
      }]);
      expect((result[0] as Record<string, unknown>)['attributes']).toEqual({ demographics: { timeZone: 'America/New_York' } });
    });

    it('uses uniqueIdentifier as id when no id is supplied', async () => {
      const result = await JustInServerless.loadUsers([{ uniqueIdentifier: 'bob', attributes: {} }]);
      expect(result[0].id).toBe('bob');
    });

    it('accepts multiple users', async () => {
      const result = await JustInServerless.loadUsers([
        { uniqueIdentifier: 'u1', attributes: {} },
        { uniqueIdentifier: 'u2', attributes: {} },
      ]);
      expect(result).toHaveLength(2);
    });

    it('atomically replaces the previous user set on each call', async () => {
      await JustInServerless.loadUsers([{ uniqueIdentifier: 'old', attributes: {} }]);
      await JustInServerless.loadUsers([{ uniqueIdentifier: 'new', attributes: {} }]);
      expect(JustInServerless.getAllUsers()).toHaveLength(1);
      expect(JustInServerless.getAllUsers()[0].uniqueIdentifier).toBe('new');
    });

    it('throws when uniqueIdentifier is missing', async () => {
      await expect(JustInServerless.loadUsers([{ uniqueIdentifier: '', attributes: {} }])).rejects.toThrow('uniqueIdentifier is missing');
    });

    it('throws on duplicate uniqueIdentifier within the same call', async () => {
      await expect(JustInServerless.loadUsers([
        { uniqueIdentifier: 'dup', attributes: {} },
        { uniqueIdentifier: 'dup', attributes: {} },
      ])).rejects.toThrow('duplicate uniqueIdentifier');
    });

    it('throws when the argument is not an array', async () => {
      await expect(JustInServerless.loadUsers(null as unknown as ServerlessUserInput[])).rejects.toThrow('expects an array');
    });
  });

  describe('loadUsers — JUser inputs', () => {
    it('accepts a persisted JUser and preserves all fields', async () => {
      const user = makeEngineTestUser({ id: 'id-1', uniqueIdentifier: 'carol' });
      const result = await JustInServerless.loadUsers([user as unknown as ServerlessUserInput]);
      expect(result[0].id).toBe('id-1');
      expect(result[0].uniqueIdentifier).toBe('carol');
    });

    it('throws on duplicate id collision across mixed inputs', async () => {
      await expect(JustInServerless.loadUsers([
        makeEngineTestUser({ id: 'shared-id', uniqueIdentifier: 'u1' }) as unknown as ServerlessUserInput,
        { uniqueIdentifier: 'shared-id', attributes: {} },
      ])).rejects.toThrow('duplicate id');
    });
  });

  describe('loadUsers — protected attributes', () => {
    it('stores protected attributes with the nested core shape', async () => {
      await JustInServerless.loadUsers([{
        uniqueIdentifier: 'alice',
        attributes: {},
        protectedAttributes: [{ namespace: 'health', protectedAttributes: { steps: 9500 } }],
      }]);
      const user = JustInServerless.getUserByUniqueIdentifier('alice')!;
      const [record] = JustInServerless.getProtectedAttributesByNamespace(user.id, ['health']);
      expect(record.namespace).toBe('health');
      expect(record.protectedAttributes).toEqual({ steps: 9500 });
    });

    it('builds record id as uniqueIdentifier:namespace', async () => {
      await JustInServerless.loadUsers([{
        uniqueIdentifier: 'alice',
        attributes: {},
        protectedAttributes: [{ namespace: 'pii', protectedAttributes: { ssn: '1234' } }],
      }]);
      const user = JustInServerless.getUserByUniqueIdentifier('alice')!;
      const [record] = JustInServerless.getProtectedAttributesByNamespace(user.id, ['pii']);
      expect(record.id).toBe('alice:pii');
    });

    it('throws when a namespace is missing', async () => {
      await expect(JustInServerless.loadUsers([{
        uniqueIdentifier: 'alice',
        attributes: {},
        protectedAttributes: [{ namespace: '', protectedAttributes: {} }],
      }])).rejects.toThrow('namespace is missing');
    });

    it('throws on duplicate namespace for the same user', async () => {
      await expect(JustInServerless.loadUsers([{
        uniqueIdentifier: 'alice',
        attributes: {},
        protectedAttributes: [
          { namespace: 'health', protectedAttributes: {} },
          { namespace: 'health', protectedAttributes: {} },
        ],
      }])).rejects.toThrow('duplicate namespace');
    });
  });

  describe('user read methods', () => {
    beforeEach(async () => {
      await JustInServerless.loadUsers([
        { uniqueIdentifier: 'alice', attributes: {} },
        { uniqueIdentifier: 'bob', attributes: {} },
      ]);
    });

    it('getAllUsers returns all loaded users', () => {
      expect(JustInServerless.getAllUsers()).toHaveLength(2);
    });

    it('getUserById returns the correct user', () => {
      const user = JustInServerless.getUserByUniqueIdentifier('alice')!;
      expect(JustInServerless.getUserById(user.id)?.uniqueIdentifier).toBe('alice');
    });

    it('getUserById returns null for unknown id', () => {
      expect(JustInServerless.getUserById('ghost')).toBeNull();
    });

    it('getUserByUniqueIdentifier returns the correct user', () => {
      expect(JustInServerless.getUserByUniqueIdentifier('bob')?.uniqueIdentifier).toBe('bob');
    });

    it('getUserByUniqueIdentifier returns null for unknown identifier', () => {
      expect(JustInServerless.getUserByUniqueIdentifier('ghost')).toBeNull();
    });
  });

  describe('getProtectedAttributesByNamespace', () => {
    beforeEach(async () => {
      await JustInServerless.loadUsers([{
        uniqueIdentifier: 'alice',
        attributes: {},
        protectedAttributes: [
          { namespace: 'health', protectedAttributes: { bpm: 72 } },
          { namespace: 'pii', protectedAttributes: { dob: '1990' } },
        ],
      }]);
    });

    it('returns only the requested namespaces', () => {
      const user = JustInServerless.getUserByUniqueIdentifier('alice')!;
      const records = JustInServerless.getProtectedAttributesByNamespace(user.id, ['health']);
      expect(records).toHaveLength(1);
      expect(records[0].namespace).toBe('health');
    });

    it('silently omits missing namespaces', () => {
      const user = JustInServerless.getUserByUniqueIdentifier('alice')!;
      const records = JustInServerless.getProtectedAttributesByNamespace(user.id, ['health', 'missing']);
      expect(records).toHaveLength(1);
    });

    it('returns an empty array for an unknown userId', () => {
      expect(JustInServerless.getProtectedAttributesByNamespace('ghost', ['health'])).toEqual([]);
    });

    it('returns an empty array when namespaces is empty', () => {
      const user = JustInServerless.getUserByUniqueIdentifier('alice')!;
      expect(JustInServerless.getProtectedAttributesByNamespace(user.id, [])).toEqual([]);
    });
  });

  describe('getAllProtectedAttributesForUser', () => {
    it('returns all records across all namespaces', async () => {
      await JustInServerless.loadUsers([{
        uniqueIdentifier: 'alice',
        attributes: {},
        protectedAttributes: [
          { namespace: 'a', protectedAttributes: {} },
          { namespace: 'b', protectedAttributes: {} },
        ],
      }]);
      const user = JustInServerless.getUserByUniqueIdentifier('alice')!;
      expect(JustInServerless.getAllProtectedAttributesForUser(user.id)).toHaveLength(2);
    });

    it('returns an empty array for a user with no protected attributes', async () => {
      await JustInServerless.loadUsers([{ uniqueIdentifier: 'alice', attributes: {} }]);
      const user = JustInServerless.getUserByUniqueIdentifier('alice')!;
      expect(JustInServerless.getAllProtectedAttributesForUser(user.id)).toEqual([]);
    });
  });

  describe('publishEvent', () => {
    beforeEach(async () => {
      await JustInServerless.loadUsers([{ uniqueIdentifier: 'alice', attributes: {} }]);
      await JustInServerless.registerEventHandlers('MY_EVENT', ['h1']);
    });

    it('calls executeEventForUsers with the correct event and users', async () => {
      const ts = new Date();
      await JustInServerless.publishEvent('MY_EVENT', ts, { key: 'val' });

      expect(executeEventForUsersStub.calledOnce).toBe(true);
      const [passedEvent, passedUsers] = executeEventForUsersStub.firstCall.args as [Record<string, unknown>, JUser[]];
      expect(passedEvent['eventType']).toBe('MY_EVENT');
      expect(passedEvent['generatedTimestamp']).toBe(ts);
      expect(passedEvent['eventDetails']).toEqual({ key: 'val' });
      expect(passedUsers).toHaveLength(1);
      expect(passedUsers[0].uniqueIdentifier).toBe('alice');
    });

    it('throws when no handlers are registered for the event type', async () => {
      await expect(JustInServerless.publishEvent('UNREGISTERED', new Date())).rejects.toThrow('no handlers registered');
    });

    it('throws when no users are loaded', async () => {
      JustInServerless.reset();
      await JustInServerless.registerEventHandlers('EV', ['h1']);
      await expect(JustInServerless.publishEvent('EV', new Date())).rejects.toThrow('no users loaded');
    });

    it('deduplicates executions for the same idempotency key', async () => {
      await JustInServerless.publishEvent('MY_EVENT', new Date(), {}, 'key-1');
      await JustInServerless.publishEvent('MY_EVENT', new Date(), {}, 'key-1');
      expect(executeEventForUsersStub.callCount).toBe(1);
    });

    it('executes separately for distinct idempotency keys', async () => {
      await JustInServerless.publishEvent('MY_EVENT', new Date(), {}, 'key-a');
      await JustInServerless.publishEvent('MY_EVENT', new Date(), {}, 'key-b');
      expect(executeEventForUsersStub.callCount).toBe(2);
    });

    it('always executes when no idempotency key is provided', async () => {
      await JustInServerless.publishEvent('MY_EVENT', new Date());
      await JustInServerless.publishEvent('MY_EVENT', new Date());
      expect(executeEventForUsersStub.callCount).toBe(2);
    });

    it('logs a warning when a duplicate idempotency key is detected', async () => {
      await JustInServerless.publishEvent('MY_EVENT', new Date(), {}, 'dup-key');
      await JustInServerless.publishEvent('MY_EVENT', new Date(), {}, 'dup-key');
      const warnLogs = engineSandbox.logs.findByMessage('Duplicate execution skipped');
      expect(warnLogs).toHaveLength(1);
    });
  });

  describe('reset', () => {
    it('clears all loaded users', async () => {
      await JustInServerless.loadUsers([{ uniqueIdentifier: 'alice', attributes: {} }]);
      JustInServerless.reset();
      expect(JustInServerless.getAllUsers()).toEqual([]);
    });

    it('clears registered event handlers', async () => {
      await JustInServerless.registerEventHandlers('EV', ['h1']);
      JustInServerless.reset();
      expect(EventHandlerManager.getInstance().hasHandlersForEventType('EV')).toBe(false);
    });

    it('clears processed idempotency keys', async () => {
      await JustInServerless.loadUsers([{ uniqueIdentifier: 'alice', attributes: {} }]);
      await JustInServerless.registerEventHandlers('EV', ['h1']);
      await JustInServerless.publishEvent('EV', new Date(), {}, 'key-1');

      JustInServerless.reset();

      await JustInServerless.loadUsers([{ uniqueIdentifier: 'alice', attributes: {} }]);
      await JustInServerless.registerEventHandlers('EV', ['h1']);
      await JustInServerless.publishEvent('EV', new Date(), {}, 'key-1');

      expect(executeEventForUsersStub.callCount).toBe(2);
    });

    it('re-disables persistence after reset', async () => {
      const { setResultRecorderPersistenceEnabled, handleDecisionRuleResult, __resetResultRecorderForTests } = require('../../handlers/result-recorder');
      const { makeCoreManagersSandbox } = require('@just-in/core/testing');

      setResultRecorderPersistenceEnabled(true);
      JustInServerless.reset();

      const coreSandbox = makeCoreManagersSandbox();
      const record = {
        event: { eventType: 'EV', generatedTimestamp: new Date() },
        name: 'rule',
        user: { id: 'u1', uniqueIdentifier: 'u1' },
        steps: [{ step: 'shouldActivate', result: { status: 'success' }, timestamp: new Date() }],
      };
      await handleDecisionRuleResult(record);

      sinon.assert.notCalled(coreSandbox.dm.addItemToCollection as sinon.SinonStub);
      coreSandbox.restore();
      __resetResultRecorderForTests();
    });
  });
});
