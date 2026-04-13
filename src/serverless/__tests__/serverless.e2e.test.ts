/**
 * JustInServerless E2E tests.
 *
 * Verifies the public API as a third-party developer would use it.
 * No internal imports — only the public surface from '@just-in/engine'.
 * No DB required — the serverless engine is fully in-memory.
 *
 * The guiding question: "Would a developer who only has the README write this?"
 */

import sinon from 'sinon';
import { silenceLogger } from '@just-in/core/testing';
import { JustInServerless } from '../../index';
import type { TaskRegistration, DecisionRuleRegistration } from '../../index';

let sb: sinon.SinonSandbox;

beforeAll(() => { sb = sinon.createSandbox(); silenceLogger(sb); });
afterAll(() => { sb.restore(); });

describe('serverless/serverless — e2e test', () => {
  afterEach(() => {
    JustInServerless.reset();
  });

  describe('loadUsers', () => {
    it('returns a normalised JUser array', async () => {
      const result = await JustInServerless.loadUsers([
        { uniqueIdentifier: 'alice', attributes: { age: 30 } },
        { uniqueIdentifier: 'bob', attributes: {} },
      ]);

      expect(result).toHaveLength(2);
      expect(result[0].uniqueIdentifier).toBe('alice');
      expect(result[1].uniqueIdentifier).toBe('bob');
    });

    it('keeps attributes nested — does not flatten onto user', async () => {
      const result = await JustInServerless.loadUsers([
        { uniqueIdentifier: 'carol', attributes: { demographics: { timeZone: 'UTC' } } },
      ]);

      expect((result[0] as Record<string, unknown>)['attributes']).toEqual({
        demographics: { timeZone: 'UTC' },
      });
    });

    it('uses uniqueIdentifier as id when no explicit id is supplied', async () => {
      const result = await JustInServerless.loadUsers([
        { uniqueIdentifier: 'dave', attributes: {} },
      ]);

      expect(result[0].id).toBe('dave');
    });

    it('atomically replaces the previous user set on each call', async () => {
      await JustInServerless.loadUsers([{ uniqueIdentifier: 'old', attributes: {} }]);
      await JustInServerless.loadUsers([{ uniqueIdentifier: 'new', attributes: {} }]);

      expect(JustInServerless.getAllUsers()).toHaveLength(1);
      expect(JustInServerless.getAllUsers()[0].uniqueIdentifier).toBe('new');
    });

    it('throws on duplicate uniqueIdentifier within the same batch', async () => {
      await expect(JustInServerless.loadUsers([
        { uniqueIdentifier: 'dup', attributes: {} },
        { uniqueIdentifier: 'dup', attributes: {} },
      ])).rejects.toThrow('duplicate uniqueIdentifier');
    });
  });

  describe('user read methods', () => {
    beforeEach(async () => {
      await JustInServerless.loadUsers([
        { uniqueIdentifier: 'alice', attributes: { role: 'admin' } },
        { uniqueIdentifier: 'bob', attributes: {} },
      ]);
    });

    it('getAllUsers returns all loaded users', () => {
      expect(JustInServerless.getAllUsers()).toHaveLength(2);
    });

    it('getUserByUniqueIdentifier returns the correct user', () => {
      expect(JustInServerless.getUserByUniqueIdentifier('alice')?.uniqueIdentifier).toBe('alice');
    });

    it('getUserByUniqueIdentifier returns null for an unknown identifier', () => {
      expect(JustInServerless.getUserByUniqueIdentifier('ghost')).toBeNull();
    });

    it('getUserById returns the correct user', () => {
      const user = JustInServerless.getUserByUniqueIdentifier('bob')!;
      expect(JustInServerless.getUserById(user.id)?.uniqueIdentifier).toBe('bob');
    });
  });

  describe('protected attributes', () => {
    beforeEach(async () => {
      await JustInServerless.loadUsers([
        {
          uniqueIdentifier: 'eve',
          attributes: {},
          protectedAttributes: [
            { namespace: 'health', protectedAttributes: { bpm: 65, steps: 8000 } },
            { namespace: 'pii', protectedAttributes: { dob: '1990-01-01' } },
          ],
        },
      ]);
    });

    it('getProtectedAttributesByNamespace returns the requested namespaces', () => {
      const user = JustInServerless.getUserByUniqueIdentifier('eve')!;
      const records = JustInServerless.getProtectedAttributesByNamespace(user.id, ['health']);

      expect(records).toHaveLength(1);
      expect(records[0].namespace).toBe('health');
      expect(records[0].protectedAttributes).toEqual({ bpm: 65, steps: 8000 });
    });

    it('getProtectedAttributesByNamespace silently omits missing namespaces', () => {
      const user = JustInServerless.getUserByUniqueIdentifier('eve')!;
      const records = JustInServerless.getProtectedAttributesByNamespace(user.id, ['health', 'missing']);

      expect(records).toHaveLength(1);
    });

    it('getAllProtectedAttributesForUser returns all namespaces', () => {
      const user = JustInServerless.getUserByUniqueIdentifier('eve')!;
      const records = JustInServerless.getAllProtectedAttributesForUser(user.id);

      expect(records).toHaveLength(2);
    });
  });

  describe('task pipeline', () => {
    it('executes a task for each loaded user', async () => {
      await JustInServerless.loadUsers([
        { uniqueIdentifier: 'frank', attributes: {} },
        { uniqueIdentifier: 'grace', attributes: {} },
      ]);

      const executedFor: string[] = [];

      const task: TaskRegistration = {
        name: 'sl_task',
        shouldActivate: async () => ({ status: 'success' }),
        doAction: async (user) => {
          executedFor.push(user.uniqueIdentifier);
          return { status: 'success' };
        },
      };

      JustInServerless.registerTask(task);
      await JustInServerless.registerEventHandlers('SL_TASK_EVENT', ['sl_task']);
      await JustInServerless.publishEvent('SL_TASK_EVENT', new Date());

      expect(executedFor).toHaveLength(2);
      expect(executedFor).toEqual(expect.arrayContaining(['frank', 'grace']));
    });

    it('does not run doAction when shouldActivate returns stop', async () => {
      await JustInServerless.loadUsers([{ uniqueIdentifier: 'henry', attributes: {} }]);

      let doActionCalled = false;

      JustInServerless.registerTask({
        name: 'sl_stop_task',
        shouldActivate: async () => ({ status: 'stop' }),
        doAction: async () => { doActionCalled = true; return { status: 'success' }; },
      });

      await JustInServerless.registerEventHandlers('SL_STOP_EVENT', ['sl_stop_task']);
      await JustInServerless.publishEvent('SL_STOP_EVENT', new Date());

      expect(doActionCalled).toBe(false);
    });
  });

  describe('decision rule pipeline', () => {
    it('runs all three steps when shouldActivate and selectAction succeed', async () => {
      await JustInServerless.loadUsers([{ uniqueIdentifier: 'ivan', attributes: {} }]);

      const steps: string[] = [];

      const rule: DecisionRuleRegistration = {
        name: 'sl_rule',
        shouldActivate: async () => { steps.push('shouldActivate'); return { status: 'success' }; },
        selectAction: async () => { steps.push('selectAction'); return { status: 'success' }; },
        doAction: async () => { steps.push('doAction'); return { status: 'success' }; },
      };

      JustInServerless.registerDecisionRule(rule);
      await JustInServerless.registerEventHandlers('SL_RULE_EVENT', ['sl_rule']);
      await JustInServerless.publishEvent('SL_RULE_EVENT', new Date());

      expect(steps).toEqual(['shouldActivate', 'selectAction', 'doAction']);
    });

    it('skips doAction when selectAction returns stop but records the run', async () => {
      await JustInServerless.loadUsers([{ uniqueIdentifier: 'julia', attributes: {} }]);

      const steps: string[] = [];

      JustInServerless.registerDecisionRule({
        name: 'sl_select_stop_rule',
        shouldActivate: async () => { steps.push('shouldActivate'); return { status: 'success' }; },
        selectAction: async () => { steps.push('selectAction'); return { status: 'stop' }; },
        doAction: async () => { steps.push('doAction'); return { status: 'success' }; },
      });

      await JustInServerless.registerEventHandlers('SL_SELECT_STOP', ['sl_select_stop_rule']);
      await JustInServerless.publishEvent('SL_SELECT_STOP', new Date());

      expect(steps).toEqual(['shouldActivate', 'selectAction']);
    });
  });

  describe('handler ordering', () => {
    it('executes handlers in registration order', async () => {
      await JustInServerless.loadUsers([{ uniqueIdentifier: 'kate', attributes: {} }]);

      const order: string[] = [];

      JustInServerless.registerTask({
        name: 'firstTask',
        shouldActivate: async () => ({ status: 'success' }),
        doAction: async () => { order.push('task'); return { status: 'success' }; },
      });

      JustInServerless.registerDecisionRule({
        name: 'secondRule',
        shouldActivate: async () => ({ status: 'success' }),
        selectAction: async () => ({ status: 'success' }),
        doAction: async () => { order.push('rule'); return { status: 'success' }; },
      });

      await JustInServerless.registerEventHandlers('ORDER_EVENT', ['firstTask', 'secondRule']);
      await JustInServerless.publishEvent('ORDER_EVENT', new Date());

      expect(order[0]).toBe('task');
      expect(order[1]).toBe('rule');
    });

    it('completes full user sweep for each handler before starting the next', async () => {
      await JustInServerless.loadUsers([
        { uniqueIdentifier: 'u1', attributes: {} },
        { uniqueIdentifier: 'u2', attributes: {} },
      ]);

      const log: string[] = [];

      JustInServerless.registerTask({
        name: 'fetchTask',
        shouldActivate: async () => ({ status: 'success' }),
        doAction: async (user) => { log.push(`fetch:${user.uniqueIdentifier}`); return { status: 'success' }; },
      });

      JustInServerless.registerDecisionRule({
        name: 'decideRule',
        shouldActivate: async () => ({ status: 'success' }),
        selectAction: async () => ({ status: 'success' }),
        doAction: async (user) => { log.push(`decide:${user.uniqueIdentifier}`); return { status: 'success' }; },
      });

      await JustInServerless.registerEventHandlers('SWEEP_EVENT', ['fetchTask', 'decideRule']);
      await JustInServerless.publishEvent('SWEEP_EVENT', new Date());

      expect(log).toEqual(['fetch:u1', 'fetch:u2', 'decide:u1', 'decide:u2']);
    });
  });

  describe('handler lifecycle hooks', () => {
    it('calls beforeExecution once and afterExecution once regardless of user count', async () => {
      await JustInServerless.loadUsers([
        { uniqueIdentifier: 'n1', attributes: {} },
        { uniqueIdentifier: 'n2', attributes: {} },
        { uniqueIdentifier: 'n3', attributes: {} },
      ]);

      let beforeCount = 0;
      let afterCount = 0;

      JustInServerless.registerTask({
        name: 'lifecycle_task',
        beforeExecution: async () => { beforeCount++; },
        shouldActivate: async () => ({ status: 'success' }),
        doAction: async () => ({ status: 'success' }),
        afterExecution: async () => { afterCount++; },
      });

      await JustInServerless.registerEventHandlers('LIFECYCLE_EVENT', ['lifecycle_task']);
      await JustInServerless.publishEvent('LIFECYCLE_EVENT', new Date());

      expect(beforeCount).toBe(1);
      expect(afterCount).toBe(1);
    });
  });

  describe('eventDetails forwarding', () => {
    it('eventDetails payload is available to the handler via the event argument', async () => {
      await JustInServerless.loadUsers([{ uniqueIdentifier: 'leo', attributes: {} }]);

      let capturedDetails: Record<string, unknown> | undefined;

      JustInServerless.registerTask({
        name: 'details_task',
        shouldActivate: async () => ({ status: 'success' }),
        doAction: async (_user, event) => {
          capturedDetails = event.eventDetails as Record<string, unknown>;
          return { status: 'success' };
        },
      });

      await JustInServerless.registerEventHandlers('DETAILS_EVENT', ['details_task']);
      await JustInServerless.publishEvent('DETAILS_EVENT', new Date(), { score: 42, label: 'test' });

      expect(capturedDetails).toEqual({ score: 42, label: 'test' });
    });
  });

  describe('idempotency key', () => {
    it('deduplicates executions for the same key within the same instance', async () => {
      await JustInServerless.loadUsers([{ uniqueIdentifier: 'mia', attributes: {} }]);

      let callCount = 0;

      JustInServerless.registerTask({
        name: 'idem_task',
        shouldActivate: async () => ({ status: 'success' }),
        doAction: async () => { callCount++; return { status: 'success' }; },
      });

      await JustInServerless.registerEventHandlers('IDEM_EVENT', ['idem_task']);
      await JustInServerless.publishEvent('IDEM_EVENT', new Date(), {}, 'run-1');
      await JustInServerless.publishEvent('IDEM_EVENT', new Date(), {}, 'run-1');

      expect(callCount).toBe(1);
    });

    it('executes separately for distinct idempotency keys', async () => {
      await JustInServerless.loadUsers([{ uniqueIdentifier: 'nina', attributes: {} }]);

      let callCount = 0;

      JustInServerless.registerTask({
        name: 'distinct_task',
        shouldActivate: async () => ({ status: 'success' }),
        doAction: async () => { callCount++; return { status: 'success' }; },
      });

      await JustInServerless.registerEventHandlers('DISTINCT_EVENT', ['distinct_task']);
      await JustInServerless.publishEvent('DISTINCT_EVENT', new Date(), {}, 'key-a');
      await JustInServerless.publishEvent('DISTINCT_EVENT', new Date(), {}, 'key-b');

      expect(callCount).toBe(2);
    });

    it('clears idempotency keys on reset — same key can be reused after reset', async () => {
      await JustInServerless.loadUsers([{ uniqueIdentifier: 'oscar', attributes: {} }]);

      let callCount = 0;

      JustInServerless.registerTask({
        name: 'reset_idem_task',
        shouldActivate: async () => ({ status: 'success' }),
        doAction: async () => { callCount++; return { status: 'success' }; },
      });

      await JustInServerless.registerEventHandlers('RESET_IDEM_EVENT', ['reset_idem_task']);
      await JustInServerless.publishEvent('RESET_IDEM_EVENT', new Date(), {}, 'key-x');

      JustInServerless.reset();

      await JustInServerless.loadUsers([{ uniqueIdentifier: 'oscar', attributes: {} }]);
      JustInServerless.registerTask({
        name: 'reset_idem_task',
        shouldActivate: async () => ({ status: 'success' }),
        doAction: async () => { callCount++; return { status: 'success' }; },
      });
      await JustInServerless.registerEventHandlers('RESET_IDEM_EVENT', ['reset_idem_task']);
      await JustInServerless.publishEvent('RESET_IDEM_EVENT', new Date(), {}, 'key-x');

      expect(callCount).toBe(2);
    });
  });

  describe('custom result writer', () => {
    it('configureTaskResultWriter receives the result envelope after task execution', async () => {
      await JustInServerless.loadUsers([{ uniqueIdentifier: 'pat', attributes: {} }]);

      const captured: unknown[] = [];
      JustInServerless.configureTaskResultWriter(async (record) => { captured.push(record); });

      JustInServerless.registerTask({
        name: 'sl_writer_task',
        shouldActivate: async () => ({ status: 'success' }),
        doAction: async () => ({ status: 'success' }),
      });

      await JustInServerless.registerEventHandlers('SL_WRITER_EVENT', ['sl_writer_task']);
      await JustInServerless.publishEvent('SL_WRITER_EVENT', new Date());

      expect(captured).toHaveLength(1);
      expect((captured[0] as Record<string, unknown>)['name']).toBe('sl_writer_task');
    });

    it('configureDecisionRuleResultWriter receives the result envelope after rule execution', async () => {
      await JustInServerless.loadUsers([{ uniqueIdentifier: 'quinn', attributes: {} }]);

      const captured: unknown[] = [];
      JustInServerless.configureDecisionRuleResultWriter(async (record) => { captured.push(record); });

      JustInServerless.registerDecisionRule({
        name: 'sl_writer_rule',
        shouldActivate: async () => ({ status: 'success' }),
        selectAction: async () => ({ status: 'success' }),
        doAction: async () => ({ status: 'success' }),
      });

      await JustInServerless.registerEventHandlers('SL_WRITER_RULE_EVENT', ['sl_writer_rule']);
      await JustInServerless.publishEvent('SL_WRITER_RULE_EVENT', new Date());

      expect(captured).toHaveLength(1);
      expect((captured[0] as Record<string, unknown>)['name']).toBe('sl_writer_rule');
    });
  });

  describe('error cases', () => {
    it('throws when publishEvent is called with no users loaded', async () => {
      JustInServerless.registerTask({
        name: 'no_users_task',
        shouldActivate: async () => ({ status: 'success' }),
        doAction: async () => ({ status: 'success' }),
      });
      await JustInServerless.registerEventHandlers('NO_USERS_EVENT', ['no_users_task']);

      await expect(JustInServerless.publishEvent('NO_USERS_EVENT', new Date()))
        .rejects.toThrow('no users loaded');
    });

    it('throws when publishEvent is called with an unregistered event type', async () => {
      await JustInServerless.loadUsers([{ uniqueIdentifier: 'rose', attributes: {} }]);

      await expect(JustInServerless.publishEvent('NOT_REGISTERED', new Date()))
        .rejects.toThrow('no handlers registered');
    });
  });

  describe('reset', () => {
    it('clears all users, handlers and state for the next invocation', async () => {
      await JustInServerless.loadUsers([{ uniqueIdentifier: 'sam', attributes: {} }]);
      await JustInServerless.registerEventHandlers('SAM_EVENT', ['someTask']);

      JustInServerless.reset();

      expect(JustInServerless.getAllUsers()).toEqual([]);
    });
  });
});
