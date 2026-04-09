import type { StepReturnResult, ExecuteStepReturn, RecordResult } from '../../handlers';
import type { CapturedEmit } from '@just-in/core/testing';

// ---------------------------------------------------------------------------
// Step result assertions
// ---------------------------------------------------------------------------

/**
 * Asserts that a {@link StepReturnResult} has `status: 'success'` and
 * returns it for further assertion.
 *
 * @example
 * ```ts
 * const result = await executeStep('shouldActivate', fn);
 * const stepResult = expectStepSuccess(result.result);
 * expect(stepResult.result?.phase).toBe('active');
 * ```
 */
function expectStepSuccess<T = Record<string, unknown>>(
  result: StepReturnResult<T>,
): StepReturnResult<T> {
  expect(result.status).toBe('success');
  return result;
}

/**
 * Asserts that a {@link StepReturnResult} has `status: 'stop'` and
 * returns it for further assertion.
 */
function expectStepStop<T = Record<string, unknown>>(
  result: StepReturnResult<T>,
): StepReturnResult<T> {
  expect(result.status).toBe('stop');
  return result;
}

/**
 * Asserts that a {@link StepReturnResult} has `status: 'error'` and
 * returns it for further assertion.
 *
 * @param messageIncludes - Optional substring to match against `error.message`.
 */
function expectStepError<T = Record<string, unknown>>(
  result: StepReturnResult<T>,
  messageIncludes?: string,
): StepReturnResult<T> {
  expect(result.status).toBe('error');
  if (messageIncludes) {
    const msg =
      result.error instanceof Error
        ? result.error.message
        : String(result.error);
    expect(msg).toContain(messageIncludes);
  }
  return result;
}

// ---------------------------------------------------------------------------
// ExecuteStepReturn assertions
// ---------------------------------------------------------------------------

/**
 * Asserts that an {@link ExecuteStepReturn} envelope has the expected step
 * name and a `success` status, and returns the inner result for further
 * assertion.
 *
 * @example
 * ```ts
 * const envelope = await executeStep('shouldActivate', fn);
 * const result = expectEnvelopeSuccess(envelope, 'shouldActivate');
 * expect(result.result?.phase).toBe('active');
 * ```
 */
function expectEnvelopeSuccess<T = unknown>(
  envelope: ExecuteStepReturn<T>,
  step?: string,
): StepReturnResult<T> {
  if (step) expect(envelope.step).toBe(step);
  expect(envelope.timestamp).toBeInstanceOf(Date);
  return expectStepSuccess(envelope.result);
}

/**
 * Asserts that an {@link ExecuteStepReturn} envelope has the expected step
 * name and an `error` status.
 */
function expectEnvelopeError<T = unknown>(
  envelope: ExecuteStepReturn<T>,
  step?: string,
): StepReturnResult<T> {
  if (step) expect(envelope.step).toBe(step);
  return expectStepError(envelope.result);
}

// ---------------------------------------------------------------------------
// RecordResult assertions
// ---------------------------------------------------------------------------

/**
 * Asserts that a {@link RecordResult} has the expected handler name and
 * at least one step entry, and returns it for further assertion.
 */
function expectRecordResult(
  record: RecordResult,
  opts: {
    name?: string;
    minSteps?: number;
    hasActivated?: boolean;
  } = {},
): RecordResult {
  if (opts.name) expect(record.name).toBe(opts.name);

  if (opts.minSteps !== undefined) {
    expect(record.steps.length).toBeGreaterThanOrEqual(opts.minSteps);
  }

  if (opts.hasActivated !== undefined) {
    const activated = record.steps.some(
      (s) => s.step === 'shouldActivate' && s.result.status === 'success',
    );
    expect(activated).toBe(opts.hasActivated);
  }

  return record;
}

// ---------------------------------------------------------------------------
// Log assertions
// ---------------------------------------------------------------------------

/**
 * Asserts properties of a captured log entry.
 *
 * Mirrors `expectLog` from `@just-in/core/testing` but typed for the engine
 * context.
 *
 * @example
 * ```ts
 * const [entry] = engineSandbox.logs.findByMessage('Event registered');
 * expectEngineLog(entry, { severity: 'INFO', messageSubstr: 'GoogleCloudClockEvent' });
 * ```
 */
function expectEngineLog(
  log: CapturedEmit | undefined,
  opts: {
    severity?: string;
    messageSubstr?: string;
    component?: string;
  } = {},
): void {
  expect(log).toBeDefined();
  if (!log) return;

  if (opts.severity) {
    expect(log.entry.severity).toBe(opts.severity);
  }

  if (opts.messageSubstr) {
    expect(String(log.entry.message)).toContain(opts.messageSubstr);
  }

  if (opts.component) {
    expect((log.ctx as Record<string, unknown>)['component']).toBe(opts.component);
  }
}

export {
  expectStepSuccess,
  expectStepStop,
  expectStepError,
  expectEnvelopeSuccess,
  expectEnvelopeError,
  expectRecordResult,
  expectEngineLog,
};
