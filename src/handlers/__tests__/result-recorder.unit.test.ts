import sinon from 'sinon';
import type { EngineSandbox } from '../../testing';
import { makeEngineSandbox, makeEvent, makeEngineTestUser } from '../../testing';
import { makeCoreManagersSandbox } from '@just-in/core/testing';
import type { CoreManagersSandbox } from '@just-in/core/testing';
import { DataManager } from '@just-in/core';

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

describe('handlers/result-recorder - unit test', () => {
  let engineSandbox: EngineSandbox;
  let coreSandbox: CoreManagersSandbox;
  let dm: sinon.SinonStubbedInstance<ReturnType<typeof DataManager.getInstance>>;

  beforeEach(() => {
    engineSandbox = makeEngineSandbox();
    coreSandbox = makeCoreManagersSandbox();
    dm = coreSandbox.dm as sinon.SinonStubbedInstance<ReturnType<typeof DataManager.getInstance>>;
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
      steps: [{ step: 'shouldActivate', result: { status: 'success' }, timestamp: new Date() }],
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
      sinon.assert.notCalled(dm.addItemToCollection);
    });

    it('passes the full record to the custom recorder', async () => {
      const recorder = jest.fn().mockResolvedValue(undefined);
      setDecisionRuleResultRecorder(recorder);
      const record = makeRecord();

      await handleDecisionRuleResult(record);

      expect(recorder).toHaveBeenCalledWith(record);
    });

    it('does not log when custom recorder succeeds', async () => {
      setDecisionRuleResultRecorder(jest.fn().mockResolvedValue(undefined));

      await handleDecisionRuleResult(makeRecord());

      expect(engineSandbox.logs.findByMessage('[result-recorder]')).toHaveLength(0);
    });

    it('falls back to DataManager when no custom recorder is set', async () => {
      dm.addItemToCollection.resolves({ ok: true, successes: [] } as any);

      await handleDecisionRuleResult(makeRecord());

      expect(dm.addItemToCollection.callCount).toBeGreaterThan(0);
      const [col1, rec1] = dm.addItemToCollection.firstCall.args as [string, unknown];
      expect(col1).toBe(DECISION_RULE_RESULTS);
      expect(typeof rec1).toBe('object');
    });

    it('falls back to DataManager when custom recorder throws', async () => {
      setDecisionRuleResultRecorder(jest.fn().mockRejectedValue(new Error('writer broke')));
      dm.addItemToCollection.resolves({ ok: true, successes: [] } as any);

      await handleDecisionRuleResult(makeRecord());

      sinon.assert.called(dm.addItemToCollection);
    });

    it('does nothing when steps array is empty', async () => {
      const recorder = jest.fn();
      setDecisionRuleResultRecorder(recorder);

      await handleDecisionRuleResult(makeRecord({ steps: [] }));

      expect(recorder).not.toHaveBeenCalled();
      sinon.assert.notCalled(dm.addItemToCollection);
    });

    it('logs at WARN and full record at INFO when DataManager returns non-ok', async () => {
      dm.addItemToCollection.resolves({
        ok: false, successes: [],
        failures: [{ code: 'DB_ERROR', reason: 'insert failed' }],
      } as any);
      const record = makeRecord();

      await handleDecisionRuleResult(record);

      const warnLogs = engineSandbox.logs.findByMessage('DataManager returned failure');
      expect(warnLogs).toHaveLength(1);
      expect(warnLogs[0].entry.severity).toBe('WARNING');

      const infoLogs = engineSandbox.logs.findByMessage('[result-recorder] Handler result');
      expect(infoLogs).toHaveLength(1);
      expect(infoLogs[0].entry.severity).toBe('INFO');
      expect((infoLogs[0].ctx as Record<string, unknown>)['record']).toBe(record);
    });

    it('logs at WARN and full record at INFO when DataManager throws', async () => {
      dm.addItemToCollection.rejects(new Error('db down'));
      const record = makeRecord();

      await handleDecisionRuleResult(record);

      const warnLogs = engineSandbox.logs.findByMessage('DataManager threw');
      expect(warnLogs).toHaveLength(1);

      const infoLogs = engineSandbox.logs.findByMessage('[result-recorder] Handler result');
      expect(infoLogs).toHaveLength(1);
      expect((infoLogs[0].ctx as Record<string, unknown>)['record']).toBe(record);
    });

    it('does not throw when DataManager throws', async () => {
      dm.addItemToCollection.rejects(new Error('db down'));
      await expect(handleDecisionRuleResult(makeRecord())).resolves.toBeUndefined();
    });
  });

  describe('handleTaskResult', () => {
    it('calls task recorder when one is set', async () => {
      const taskRecorder = jest.fn().mockResolvedValue(undefined);
      setTaskResultRecorder(taskRecorder);

      await handleTaskResult(makeRecord());

      expect(taskRecorder).toHaveBeenCalledTimes(1);
      sinon.assert.notCalled(dm.addItemToCollection);
    });

    it('delegates to decision rule recorder when no task recorder is set', async () => {
      const drRecorder = jest.fn().mockResolvedValue(undefined);
      setDecisionRuleResultRecorder(drRecorder);

      await handleTaskResult(makeRecord());

      expect(drRecorder).toHaveBeenCalledTimes(1);
      sinon.assert.notCalled(dm.addItemToCollection);
    });

    it('falls back to DataManager when neither recorder is set', async () => {
      dm.addItemToCollection.resolves({ ok: true, successes: [] } as any);

      await handleTaskResult(makeRecord());

      expect(dm.addItemToCollection.callCount).toBeGreaterThan(0);
      const [col2, rec2] = dm.addItemToCollection.firstCall.args as [string, unknown];
      expect(col2).toBe(TASK_RESULTS);
      expect(typeof rec2).toBe('object');
    });

    it('falls back to DataManager when task recorder throws', async () => {
      setTaskResultRecorder(jest.fn().mockRejectedValue(new Error('task writer broke')));
      dm.addItemToCollection.resolves({ ok: true, successes: [] } as any);

      await handleTaskResult(makeRecord());

      sinon.assert.called(dm.addItemToCollection);
    });

    it('falls back to DataManager when delegated DR recorder throws', async () => {
      setDecisionRuleResultRecorder(jest.fn().mockRejectedValue(new Error('dr writer broke')));
      dm.addItemToCollection.resolves({ ok: true, successes: [] } as any);

      await handleTaskResult(makeRecord());

      sinon.assert.called(dm.addItemToCollection);
    });

    it('does nothing when steps array is empty', async () => {
      const recorder = jest.fn();
      setTaskResultRecorder(recorder);

      await handleTaskResult(makeRecord({ steps: [] }));

      expect(recorder).not.toHaveBeenCalled();
    });

    it('does not throw when DataManager throws', async () => {
      dm.addItemToCollection.rejects(new Error('db down'));
      await expect(handleTaskResult(makeRecord())).resolves.toBeUndefined();
    });
  });

  describe('setResultRecorderPersistenceEnabled(false) — serverless mode', () => {
    it('never calls DataManager when persistence is disabled', async () => {
      setResultRecorderPersistenceEnabled(false);

      await handleDecisionRuleResult(makeRecord());
      await handleTaskResult(makeRecord());

      sinon.assert.notCalled(dm.addItemToCollection);
    });

    it('logs the full record at INFO when no custom writer is set', async () => {
      setResultRecorderPersistenceEnabled(false);
      const record = makeRecord();

      await handleDecisionRuleResult(record);

      const infoLogs = engineSandbox.logs.findByMessage('[result-recorder] Handler result');
      expect(infoLogs).toHaveLength(1);
      expect(infoLogs[0].entry.severity).toBe('INFO');
      expect((infoLogs[0].ctx as Record<string, unknown>)['record']).toBe(record);
    });

    it('does not log when a custom writer is set and succeeds', async () => {
      setResultRecorderPersistenceEnabled(false);
      setDecisionRuleResultRecorder(jest.fn().mockResolvedValue(undefined));

      await handleDecisionRuleResult(makeRecord());

      expect(engineSandbox.logs.findByMessage('[result-recorder] Handler result')).toHaveLength(0);
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
    it('clears custom recorders so DataManager is used again', async () => {
      setDecisionRuleResultRecorder(jest.fn());
      setTaskResultRecorder(jest.fn());
      __resetResultRecorderForTests();

      dm.addItemToCollection.resolves({ ok: true, successes: [] } as any);
      await handleDecisionRuleResult(makeRecord());

      sinon.assert.called(dm.addItemToCollection);
    });

    it('re-enables persistence after being disabled', async () => {
      setResultRecorderPersistenceEnabled(false);
      __resetResultRecorderForTests();

      dm.addItemToCollection.resolves({ ok: true, successes: [] } as any);
      await handleDecisionRuleResult(makeRecord());

      sinon.assert.called(dm.addItemToCollection);
    });
  });
});
