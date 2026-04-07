import { makeEngineSandbox, makeEvent, makeEngineTestUser } from '../../testing';
import { makeCoreManagersSandbox } from '@just-in/core/testing';
import type { CoreManagersSandbox } from '@just-in/core/testing';

import {
  handleDecisionRuleResult,
  handleTaskResult,
  hasResultRecord,
  setDecisionRuleResultRecorder,
  setTaskResultRecorder,
  setResultRecorderPersistenceEnabled,
  __resetResultRecorderForTests,
} from '../result-recorder';
import type { RecordResult } from '../types';
import { DECISION_RULE_RESULTS, TASK_RESULTS } from '../../constants';

describe('handlers/result-recorder', () => {
  const engineSandbox = makeEngineSandbox();
  let coreSandbox: CoreManagersSandbox;

  beforeEach(() => {
    engineSandbox.reset();
    coreSandbox = makeCoreManagersSandbox();
    __resetResultRecorderForTests();
  });

  afterEach(() => {
    coreSandbox.restore();
    engineSandbox.restore();
  });

  function makeRecord(overrides: Partial<RecordResult> = {}): RecordResult {
    return {
      event: makeEvent(),
      name: 'testHandler',
      user: makeEngineTestUser(),
      steps: [
        {
          step: 'shouldActivate',
          result: { status: 'success' },
          timestamp: new Date(),
        },
      ],
      ...overrides,
    };
  }

  describe('hasResultRecord', () => {
    it('returns true when steps array is non-empty', () => {
      expect(hasResultRecord(makeRecord())).toBe(true);
    });

    it('returns false when steps array is empty', () => {
      expect(hasResultRecord(makeRecord({ steps: [] }))).toBe(false);
    });
  });

  describe('handleDecisionRuleResult', () => {
    it('calls custom recorder when one is set', async () => {
      const recorder = jest.fn().mockResolvedValue(undefined);
      setDecisionRuleResultRecorder(recorder);

      await handleDecisionRuleResult(makeRecord());

      expect(recorder).toHaveBeenCalledTimes(1);
      expect(coreSandbox.dm.addItemToCollection).not.toHaveBeenCalled();
    });

    it('passes the full record to the custom recorder', async () => {
      const recorder = jest.fn().mockResolvedValue(undefined);
      setDecisionRuleResultRecorder(recorder);
      const record = makeRecord();

      await handleDecisionRuleResult(record);

      expect(recorder).toHaveBeenCalledWith(record);
    });

    it('falls back to DataManager when no custom recorder is set', async () => {
      coreSandbox.dm.addItemToCollection.resolves({ ok: true, successes: [] } as any);

      await handleDecisionRuleResult(makeRecord());

      expect(coreSandbox.dm.addItemToCollection).toHaveBeenCalledWith(
        DECISION_RULE_RESULTS,
        expect.any(Object),
      );
    });

    it('falls back to DataManager when custom recorder throws', async () => {
      setDecisionRuleResultRecorder(jest.fn().mockRejectedValue(new Error('writer broke')));
      coreSandbox.dm.addItemToCollection.resolves({ ok: true, successes: [] } as any);

      await handleDecisionRuleResult(makeRecord());

      expect(coreSandbox.dm.addItemToCollection).toHaveBeenCalled();
    });

    it('does nothing when steps array is empty', async () => {
      const recorder = jest.fn();
      setDecisionRuleResultRecorder(recorder);

      await handleDecisionRuleResult(makeRecord({ steps: [] }));

      expect(recorder).not.toHaveBeenCalled();
      expect(coreSandbox.dm.addItemToCollection).not.toHaveBeenCalled();
    });

    it('does not throw when DataManager returns a non-ok result', async () => {
      coreSandbox.dm.addItemToCollection.resolves({
        ok: false,
        successes: [],
        failures: [{ code: 'DB_ERROR', reason: 'insert failed' }],
      } as any);

      await expect(handleDecisionRuleResult(makeRecord())).resolves.toBeUndefined();
    });

    it('does not throw when DataManager throws', async () => {
      coreSandbox.dm.addItemToCollection.rejects(new Error('db down'));

      await expect(handleDecisionRuleResult(makeRecord())).resolves.toBeUndefined();
    });
  });

  describe('handleTaskResult', () => {
    it('calls task recorder when one is set', async () => {
      const taskRecorder = jest.fn().mockResolvedValue(undefined);
      setTaskResultRecorder(taskRecorder);

      await handleTaskResult(makeRecord());

      expect(taskRecorder).toHaveBeenCalledTimes(1);
      expect(coreSandbox.dm.addItemToCollection).not.toHaveBeenCalled();
    });

    it('delegates to decision rule recorder when no task recorder is set', async () => {
      const drRecorder = jest.fn().mockResolvedValue(undefined);
      setDecisionRuleResultRecorder(drRecorder);

      await handleTaskResult(makeRecord());

      expect(drRecorder).toHaveBeenCalledTimes(1);
      expect(coreSandbox.dm.addItemToCollection).not.toHaveBeenCalled();
    });

    it('falls back to DataManager when neither recorder is set', async () => {
      coreSandbox.dm.addItemToCollection.resolves({ ok: true, successes: [] } as any);

      await handleTaskResult(makeRecord());

      expect(coreSandbox.dm.addItemToCollection).toHaveBeenCalledWith(
        TASK_RESULTS,
        expect.any(Object),
      );
    });

    it('falls back to DataManager when task recorder throws', async () => {
      setTaskResultRecorder(jest.fn().mockRejectedValue(new Error('task writer broke')));
      coreSandbox.dm.addItemToCollection.resolves({ ok: true, successes: [] } as any);

      await handleTaskResult(makeRecord());

      expect(coreSandbox.dm.addItemToCollection).toHaveBeenCalled();
    });

    it('falls back to DataManager when delegated DR recorder throws', async () => {
      setDecisionRuleResultRecorder(jest.fn().mockRejectedValue(new Error('dr writer broke')));
      coreSandbox.dm.addItemToCollection.resolves({ ok: true, successes: [] } as any);

      await handleTaskResult(makeRecord());

      expect(coreSandbox.dm.addItemToCollection).toHaveBeenCalled();
    });

    it('does nothing when steps array is empty', async () => {
      const recorder = jest.fn();
      setTaskResultRecorder(recorder);

      await handleTaskResult(makeRecord({ steps: [] }));

      expect(recorder).not.toHaveBeenCalled();
    });

    it('does not throw when DataManager throws', async () => {
      coreSandbox.dm.addItemToCollection.rejects(new Error('db down'));

      await expect(handleTaskResult(makeRecord())).resolves.toBeUndefined();
    });
  });

  describe('setResultRecorderPersistenceEnabled(false)', () => {
    it('never calls DataManager when persistence is disabled', async () => {
      setResultRecorderPersistenceEnabled(false);

      await handleDecisionRuleResult(makeRecord());
      await handleTaskResult(makeRecord());

      expect(coreSandbox.dm.addItemToCollection).not.toHaveBeenCalled();
    });

    it('still calls custom recorder when persistence is disabled', async () => {
      setResultRecorderPersistenceEnabled(false);
      const recorder = jest.fn().mockResolvedValue(undefined);
      setDecisionRuleResultRecorder(recorder);

      await handleDecisionRuleResult(makeRecord());

      expect(recorder).toHaveBeenCalledTimes(1);
    });
  });

  describe('__resetResultRecorderForTests', () => {
    it('clears custom recorders', async () => {
      setDecisionRuleResultRecorder(jest.fn());
      setTaskResultRecorder(jest.fn());
      __resetResultRecorderForTests();

      coreSandbox.dm.addItemToCollection.resolves({ ok: true, successes: [] } as any);
      await handleDecisionRuleResult(makeRecord());

      expect(coreSandbox.dm.addItemToCollection).toHaveBeenCalled();
    });

    it('re-enables persistence after being disabled', async () => {
      setResultRecorderPersistenceEnabled(false);
      __resetResultRecorderForTests();

      coreSandbox.dm.addItemToCollection.resolves({ ok: true, successes: [] } as any);
      await handleDecisionRuleResult(makeRecord());

      expect(coreSandbox.dm.addItemToCollection).toHaveBeenCalled();
    });
  });
});
