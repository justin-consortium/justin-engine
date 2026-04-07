import { makeEngineSandbox } from '../../testing';
import { executeStep } from '../steps';
import type { StepReturnResult } from '../types';

describe('handlers/steps — executeStep', () => {
  const engineSandbox = makeEngineSandbox();

  beforeEach(() => engineSandbox.reset());
  afterEach(() => engineSandbox.restore());

  // ---------------------------------------------------------------------------
  // Return envelope shape
  // ---------------------------------------------------------------------------

  describe('return envelope', () => {
    it('returns a step envelope with the correct step name', async () => {
      const envelope = await executeStep('myStep', async () => ({ status: 'success' }));

      expect(envelope.step).toBe('myStep');
    });

    it('records a timestamp at the start of execution', async () => {
      const before = new Date();
      const envelope = await executeStep('myStep', async () => ({ status: 'success' }));
      const after = new Date();

      expect(envelope.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(envelope.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('passes the full StepReturnResult through unchanged', async () => {
      const stepResult: StepReturnResult = {
        status: 'success',
        result: { decisionPointType: 'morning', score: 42 },
      };

      const envelope = await executeStep('myStep', async () => stepResult);

      expect(envelope.result).toEqual(stepResult);
    });
  });

  // ---------------------------------------------------------------------------
  // Valid statuses pass through
  // ---------------------------------------------------------------------------

  describe('valid statuses', () => {
    it('passes through a "success" status unchanged', async () => {
      const envelope = await executeStep('s', async () => ({ status: 'success', result: { x: 1 } }));

      expect(envelope.result.status).toBe('success');
      expect(envelope.result.result).toEqual({ x: 1 });
    });

    it('passes through a "stop" status unchanged', async () => {
      const envelope = await executeStep('s', async () => ({
        status: 'stop',
        result: { reason: 'not in phase' },
      }));

      expect(envelope.result.status).toBe('stop');
    });

    it('passes through an "error" status unchanged', async () => {
      const err = new Error('known failure');
      const envelope = await executeStep('s', async () => ({
        status: 'error',
        error: err,
      }));

      expect(envelope.result.status).toBe('error');
      expect(envelope.result.error).toBe(err);
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling — never throws
  // ---------------------------------------------------------------------------

  describe('error handling', () => {
    it('catches a thrown error and returns an error envelope without rethrowing', async () => {
      const thrown = new Error('step exploded');

      const envelope = await executeStep('badStep', async () => {
        throw thrown;
      });

      expect(envelope.step).toBe('badStep');
      expect(envelope.result.status).toBe('error');
      expect(envelope.result.error).toBe(thrown);
    });

    it('wraps a non-Error thrown value in an error envelope', async () => {
      const envelope = await executeStep('badStep', async () => {
        throw 'string error';
      });

      expect(envelope.result.status).toBe('error');
      expect(envelope.result.error).toBe('string error');
    });

    it('treats an invalid status string as an error envelope', async () => {
      const envelope = await executeStep('badStatus', async () => ({
        status: 'invalid_status' as 'success',
      }));

      expect(envelope.result.status).toBe('error');
      expect((envelope.result.error as Error).message).toMatch(
        /Invalid status "invalid_status"/,
      );
    });

    it('includes the step name in the invalid status error message', async () => {
      const envelope = await executeStep('myNamedStep', async () => ({
        status: 'unknown' as 'success',
      }));

      expect((envelope.result.error as Error).message).toMatch(/step "myNamedStep"/);
    });

    it('resolves even when the fn rejects with a non-Error', async () => {
      const envelope = await executeStep('rejectStep', async () => {
        return Promise.reject(42);
      });

      expect(envelope.result.status).toBe('error');
      expect(envelope.result.error).toBe(42);
    });
  });

  // ---------------------------------------------------------------------------
  // Generic type parameter
  // ---------------------------------------------------------------------------

  describe('generic type parameter', () => {
    it('preserves typed result payload through the envelope', async () => {
      type MyResult = { decisionPointType: 'morning' | 'midday' };

      const envelope = await executeStep<MyResult>('typed', async () => ({
        status: 'success',
        result: { decisionPointType: 'morning' },
      }));

      expect(envelope.result.result?.decisionPointType).toBe('morning');
    });
  });
});
