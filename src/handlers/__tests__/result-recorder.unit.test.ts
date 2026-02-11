import sinon from 'sinon';

import { makeEngineSandbox } from '../../testing';

import * as Recorder from '../result-recorder';
import {DataManager} from '@just-in/core';
import {
  DECISION_RULE_RESULTS,
  TASK_RESULTS,
} from '../../constants';


describe('Result Recorder Module', () => {
  const engineSandbox = makeEngineSandbox();

  let dmInstance: { addItemToCollection: sinon.SinonStub };
  let getInstanceStub: sinon.SinonStub;

  const emptyRecord = { steps: [] } as any;
  const nonEmptyRecord = {
    steps: [{}, {}],
    taskName: 'T',
    ruleName: 'R',
    userId: 'U1',
    status: 'OK',
  } as any;

  beforeEach(async () => {
    // Arrange
    await engineSandbox.reset();

    if (typeof (Recorder as any).__testOnlyResetRecorderState__ === 'function') {
      (Recorder as any).__testOnlyResetRecorderState__();
    } else {
      Recorder.setDecisionRuleResultRecorder(null as any);
      Recorder.setTaskResultRecorder(null as any);
      if (typeof (Recorder as any).setResultRecorderPersistenceEnabled === 'function') {
        (Recorder as any).setResultRecorderPersistenceEnabled(true);
      }
    }

    dmInstance = { addItemToCollection: engineSandbox.sb.stub().resolves() };
    getInstanceStub = engineSandbox.sb.stub(DataManager, 'getInstance').returns(dmInstance as any);
  });

  afterEach(async () => {
    await engineSandbox.restore();
  });

  describe('hasResultRecord', () => {
    it('returns false for empty steps', () => {
      // Arrange / Act
      const result = Recorder.hasResultRecord(emptyRecord);

      // Assert
      expect(result).toBe(false);
    });

    it('returns true for non-empty steps', () => {
      // Arrange / Act
      const result = Recorder.hasResultRecord(nonEmptyRecord);

      // Assert
      expect(result).toBe(true);
    });
  });

  describe('handleDecisionRuleResult', () => {
    it('calls decision recorder when set and does not touch DataManager', async () => {
      // Arrange
      const callback = engineSandbox.sb.spy();
      Recorder.setDecisionRuleResultRecorder(callback);

      // Act
      await Recorder.handleDecisionRuleResult(nonEmptyRecord);

      // Assert
      expect(callback.calledOnceWithExactly(nonEmptyRecord)).toBe(true);
      expect(getInstanceStub.called).toBe(false);
      expect(dmInstance.addItemToCollection.called).toBe(false);
    });

    it('defaults to DataManager add when no writer is set', async () => {
      // Arrange

      // Act
      await Recorder.handleDecisionRuleResult(nonEmptyRecord);

      // Assert
      expect(getInstanceStub.calledOnce).toBe(true);
      expect(
        dmInstance.addItemToCollection.calledOnceWithExactly(
          DECISION_RULE_RESULTS,
          nonEmptyRecord,
        ),
      ).toBe(true);
    });

    it('resolves when DataManager.getInstance throws', async () => {
      // Arrange
      getInstanceStub.restore();
      engineSandbox.sb.stub(DataManager, 'getInstance').throws(new Error('no DM'));

      // Act / Assert
      await expect(
        Recorder.handleDecisionRuleResult(nonEmptyRecord),
      ).resolves.toBeUndefined();
    });

    it('falls back to DataManager when custom decision writer throws', async () => {
      // Arrange
      Recorder.setDecisionRuleResultRecorder(() => {
        throw new Error('boom');
      });

      // Act
      await Recorder.handleDecisionRuleResult(nonEmptyRecord);

      // Assert
      expect(getInstanceStub.calledOnce).toBe(true);
      expect(
        dmInstance.addItemToCollection.calledOnceWithExactly(
          DECISION_RULE_RESULTS,
          nonEmptyRecord,
        ),
      ).toBe(true);
    });

    it('resolves when DataManager write fails', async () => {
      // Arrange
      dmInstance.addItemToCollection.rejects(new Error('dm write failed'));

      // Act / Assert
      await expect(
        Recorder.handleDecisionRuleResult(nonEmptyRecord),
      ).resolves.toBeUndefined();

      expect(dmInstance.addItemToCollection.calledOnce).toBe(true);
    });

    it('no-op when steps are empty', async () => {
      // Arrange

      // Act
      await Recorder.handleDecisionRuleResult(emptyRecord);

      // Assert
      expect(getInstanceStub.called).toBe(false);
      expect(dmInstance.addItemToCollection.called).toBe(false);
    });
  });

  describe('handleTaskResult', () => {
    it('calls task recorder when set and does not touch DataManager', async () => {
      // Arrange
      const taskCb = engineSandbox.sb.spy();
      Recorder.setTaskResultRecorder(taskCb);

      // Act
      await Recorder.handleTaskResult(nonEmptyRecord);

      // Assert
      expect(taskCb.calledOnceWithExactly(nonEmptyRecord)).toBe(true);
      expect(getInstanceStub.called).toBe(false);
      expect(dmInstance.addItemToCollection.called).toBe(false);
    });

    it('falls back to decision recorder when task recorder not set', async () => {
      // Arrange
      const decisionCb = engineSandbox.sb.spy();
      Recorder.setDecisionRuleResultRecorder(decisionCb);

      // Act
      await Recorder.handleTaskResult(nonEmptyRecord);

      // Assert
      expect(decisionCb.calledOnceWithExactly(nonEmptyRecord)).toBe(true);
      expect(getInstanceStub.called).toBe(false);
      expect(dmInstance.addItemToCollection.called).toBe(false);
    });

    it('defaults to DataManager add when no writers set', async () => {
      // Arrange

      // Act
      await Recorder.handleTaskResult(nonEmptyRecord);

      // Assert
      expect(getInstanceStub.calledOnce).toBe(true);
      expect(
        dmInstance.addItemToCollection.calledOnceWithExactly(
          TASK_RESULTS,
          nonEmptyRecord,
        ),
      ).toBe(true);
    });

    it('falls back to DataManager when task writer throws', async () => {
      // Arrange
      Recorder.setTaskResultRecorder(() => {
        throw new Error('boom');
      });

      // Act
      await Recorder.handleTaskResult(nonEmptyRecord);

      // Assert
      expect(getInstanceStub.calledOnce).toBe(true);
      expect(
        dmInstance.addItemToCollection.calledOnceWithExactly(
          TASK_RESULTS,
          nonEmptyRecord,
        ),
      ).toBe(true);
    });

    it('falls back to DataManager when delegated decision writer throws', async () => {
      // Arrange
      Recorder.setDecisionRuleResultRecorder(() => {
        throw new Error('boom');
      });

      // Act
      await Recorder.handleTaskResult(nonEmptyRecord);

      // Assert
      expect(getInstanceStub.calledOnce).toBe(true);
      expect(
        dmInstance.addItemToCollection.calledOnceWithExactly(
          TASK_RESULTS,
          nonEmptyRecord,
        ),
      ).toBe(true);
    });

    it('resolves when DataManager.getInstance throws', async () => {
      // Arrange
      getInstanceStub.restore();
      engineSandbox.sb.stub(DataManager, 'getInstance').throws(new Error('no DM'));

      // Act / Assert
      await expect(Recorder.handleTaskResult(nonEmptyRecord)).resolves.toBeUndefined();
    });

    it('resolves when DataManager write rejects', async () => {
      // Arrange
      dmInstance.addItemToCollection.rejects(new Error('dm write failed'));

      // Act / Assert
      await expect(Recorder.handleTaskResult(nonEmptyRecord)).resolves.toBeUndefined();
      expect(dmInstance.addItemToCollection.calledOnce).toBe(true);
    });

    it('no-op when steps are empty', async () => {
      // Arrange

      // Act
      await Recorder.handleTaskResult(emptyRecord);

      // Assert
      expect(getInstanceStub.called).toBe(false);
      expect(dmInstance.addItemToCollection.called).toBe(false);
    });
  });

  describe('Lite mode (persistence disabled)', () => {
    beforeEach(() => {
      // Arrange
      if (typeof (Recorder as any).setResultRecorderPersistenceEnabled === 'function') {
        (Recorder as any).setResultRecorderPersistenceEnabled(false);
      }

      getInstanceStub.resetHistory();
      dmInstance.addItemToCollection.resetHistory();
    });

    afterEach(() => {
      // Arrange
      if (typeof (Recorder as any).setResultRecorderPersistenceEnabled === 'function') {
        (Recorder as any).setResultRecorderPersistenceEnabled(true);
      }
    });

    it('decision: with no writers, never calls DataManager.getInstance', async () => {
      // Arrange

      // Act
      await Recorder.handleDecisionRuleResult(nonEmptyRecord);

      // Assert
      expect(getInstanceStub.called).toBe(false);
      expect(dmInstance.addItemToCollection.called).toBe(false);
    });

    it('task: with no writers, never calls DataManager.getInstance', async () => {
      // Arrange

      // Act
      await Recorder.handleTaskResult(nonEmptyRecord);

      // Assert
      expect(getInstanceStub.called).toBe(false);
      expect(dmInstance.addItemToCollection.called).toBe(false);
    });

    it('custom writer still used and no DataManager calls (decision)', async () => {
      // Arrange
      const cb = engineSandbox.sb.stub().resolves();
      Recorder.setDecisionRuleResultRecorder(cb);

      // Act
      await Recorder.handleDecisionRuleResult(nonEmptyRecord);

      // Assert
      expect(cb.calledOnceWithExactly(nonEmptyRecord)).toBe(true);
      expect(getInstanceStub.called).toBe(false);
      expect(dmInstance.addItemToCollection.called).toBe(false);
    });

    it('custom writer throws and still no DataManager calls (task)', async () => {
      // Arrange
      Recorder.setTaskResultRecorder(() => {
        throw new Error('boom');
      });

      // Act
      await Recorder.handleTaskResult(nonEmptyRecord);

      // Assert
      expect(getInstanceStub.called).toBe(false);
      expect(dmInstance.addItemToCollection.called).toBe(false);
    });
  });
});
