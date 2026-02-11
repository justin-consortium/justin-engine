import sinon from 'sinon';
import { loggerSpies } from '@just-in/core/testing';

import { executeStep } from '../steps.helpers';

describe('executeStep', () => {
  let sb: sinon.SinonSandbox;
  let lg: ReturnType<typeof loggerSpies>;

  beforeEach(() => {
    sb = sinon.createSandbox();
    lg = loggerSpies({ ctx: { testFile: 'steps.helpers.unit' } });
  });

  afterEach(() => {
    sb.restore();
    lg.restore();
  });

  it('returns step, result, and timestamp when fn resolves with status "success"', async () => {
    // Arrange
    const fn = sb.stub().resolves({ status: 'success', value: 123 });

    // Act
    const out = await executeStep<number>('STEP_A', fn);

    // Assert
    expect(fn.calledOnce).toBe(true);
    expect(out.step).toBe('STEP_A');
    expect(out.result).toEqual({ status: 'success', value: 123 });
    expect(out.timestamp).toBeInstanceOf(Date);

    const errLogs = lg.findByMessage('Error in step execution.');
    expect(errLogs.length).toBe(0);
  });

  it('returns status "stop" when fn resolves with status "stop"', async () => {
    // Arrange
    const fn = sb.stub().resolves({ status: 'stop' });

    // Act
    const out = await executeStep('STEP_STOP', fn);

    // Assert
    expect(fn.calledOnce).toBe(true);
    expect(out.step).toBe('STEP_STOP');
    expect(out.result).toEqual({ status: 'stop' });
    expect(out.timestamp).toBeInstanceOf(Date);

    const errLogs = lg.findByMessage('Error in step execution.');
    expect(errLogs.length).toBe(0);
  });

  it('passes through status "error" returned by fn (does not log)', async () => {
    // Arrange
    const returnedError = new Error('returned');
    const fn = sb.stub().resolves({ status: 'error', error: returnedError });

    // Act
    const out = await executeStep('STEP_ERROR', fn);

    // Assert
    expect(fn.calledOnce).toBe(true);
    expect(out.step).toBe('STEP_ERROR');
    expect(out.result).toEqual({ status: 'error', error: returnedError });

    const errLogs = lg.findByMessage('Error in step execution.');
    expect(errLogs.length).toBe(0);
  });

  it('catches thrown errors, logs once, and returns status "error"', async () => {
    // Arrange
    const thrown = new Error('boom');
    const fn = sb.stub().rejects(thrown);

    // Act
    const out = await executeStep('STEP_THROW', fn);

    // Assert
    expect(fn.calledOnce).toBe(true);
    expect(out.step).toBe('STEP_THROW');
    expect(out.result.status).toBe('error');
    expect((out.result as any).error).toBe(thrown);
    expect(out.timestamp).toBeInstanceOf(Date);

    const errLogs = lg.findByMessage('Error in step execution.');
    expect(errLogs.length).toBe(1);

    expect(errLogs[0].ctx.step).toBe('STEP_THROW');

    const loggedError = errLogs[0].ctx.error as any;
    expect(loggedError).toBeTruthy();
    expect(loggedError.name).toBe('Error');
    expect(loggedError.message).toBe('boom');

  });

  it('treats invalid status as an error, logs once, and returns status "error"', async () => {
    // Arrange
    const fn = sb.stub().resolves({ status: 'nope' });

    // Act
    const out = await executeStep('STEP_INVALID', fn as any);

    // Assert
    expect(fn.calledOnce).toBe(true);
    expect(out.step).toBe('STEP_INVALID');
    expect(out.result.status).toBe('error');
    expect(out.timestamp).toBeInstanceOf(Date);

    const err = (out.result as any).error as Error;
    expect(err).toBeInstanceOf(Error);
    expect(String(err.message)).toContain('Invalid status "nope"');
    expect(String(err.message)).toContain('STEP_INVALID');

    const errLogs = lg.findByMessage('Error in step execution.');
    expect(errLogs.length).toBe(1);
    expect(errLogs[0].ctx.step).toBe('STEP_INVALID');
  });
});
