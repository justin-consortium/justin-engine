import sinon from 'sinon';
import type { EngineSandbox } from '../../testing';
import { makeEngineSandbox } from '../../testing';
import { IntervalTimerEventGenerator } from '../timer';
import * as Queue from '../queue';

describe('event/timer — unit test', () => {
  let engineSandbox: EngineSandbox;
  let publishEventStub: sinon.SinonStub;
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    engineSandbox = makeEngineSandbox();
    publishEventStub = engineSandbox.sb.stub(Queue, 'publishEvent').resolves();
    clock = sinon.useFakeTimers();
  });

  afterEach(() => {
    clock.restore();
    engineSandbox.restore();
  });

  describe('constructor guards', () => {
    it('throws when interval is zero', () => {
      expect(() => new IntervalTimerEventGenerator(0, 'EV')).toThrow('interval must be greater than 0');
    });

    it('throws when interval is negative', () => {
      expect(() => new IntervalTimerEventGenerator(-100, 'EV')).toThrow('interval must be greater than 0');
    });

    it('throws when event type name is empty', () => {
      expect(() => new IntervalTimerEventGenerator(1000, '')).toThrow('event type name is required');
    });

    it('throws when event type name is only whitespace', () => {
      expect(() => new IntervalTimerEventGenerator(1000, '   ')).toThrow('event type name is required');
    });
  });

  describe('real-time mode', () => {
    it('publishes the event type on each tick', () => {
      const gen = new IntervalTimerEventGenerator(1000, 'TICK_EVENT');
      gen.start();
      clock.tick(3000);
      expect(publishEventStub.callCount).toBe(3);
      expect(publishEventStub.firstCall.args[0]).toBe('TICK_EVENT');
    });

    it('publishes a current timestamp on each tick', () => {
      const gen = new IntervalTimerEventGenerator(1000, 'TICK_EVENT');
      gen.start();
      const before = new Date(clock.now);
      clock.tick(1000);
      const after = new Date(clock.now);
      const publishedTimestamp = publishEventStub.firstCall.args[1] as Date;
      expect(publishedTimestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(publishedTimestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('stops publishing after stop() is called', () => {
      const gen = new IntervalTimerEventGenerator(1000, 'STOP_EVENT');
      gen.start();
      clock.tick(2000);
      gen.stop();
      clock.tick(2000);
      expect(publishEventStub.callCount).toBe(2);
    });

    it('is safe to call stop() before start()', () => {
      const gen = new IntervalTimerEventGenerator(1000, 'SAFE_STOP');
      expect(() => gen.stop()).not.toThrow();
    });

    it('is safe to call stop() multiple times', () => {
      const gen = new IntervalTimerEventGenerator(1000, 'MULTI_STOP');
      gen.start();
      gen.stop();
      expect(() => gen.stop()).not.toThrow();
    });

    it('logs an error and does not throw when publishEvent rejects', async () => {
      publishEventStub.rejects(new Error('queue down'));
      const gen = new IntervalTimerEventGenerator(1000, 'ERROR_EVENT');
      gen.start();
      clock.tick(1000);
      await Promise.resolve();
      const errorLogs = engineSandbox.logs.findByMessage('Failed to publish timer event');
      expect(errorLogs).toHaveLength(1);
      expect(errorLogs[0].entry.severity).toBe('ERROR');
    });
  });

  describe('simulated mode', () => {
    it('publishes events with timestamps based on simulatedStartDate', () => {
      const startDate = new Date('2024-01-01T00:00:00.000Z');
      const gen = new IntervalTimerEventGenerator(60_000, 'SIM_EVENT', {
        simulatedStartDate: startDate,
        simulatedTickDurationInMs: 10,
        simulatedTickCountMax: 3,
      });
      gen.start();
      clock.tick(30);
      expect(publishEventStub.callCount).toBe(3);
      expect(publishEventStub.getCall(0).args[1].getTime()).toBe(startDate.getTime());
      expect(publishEventStub.getCall(1).args[1].getTime()).toBe(startDate.getTime() + 60_000);
      expect(publishEventStub.getCall(2).args[1].getTime()).toBe(startDate.getTime() + 120_000);
    });

    it('advances timestamp by intervalInMs on each tick regardless of wall-clock speed', () => {
      const startDate = new Date('2024-01-01T00:00:00.000Z');
      const gen = new IntervalTimerEventGenerator(15 * 60_000, 'SIM_EVENT', {
        simulatedStartDate: startDate,
        simulatedTickDurationInMs: 5,
        simulatedTickCountMax: 2,
      });
      gen.start();
      clock.tick(10);
      const ts0 = publishEventStub.getCall(0).args[1] as Date;
      const ts1 = publishEventStub.getCall(1).args[1] as Date;
      expect(ts1.getTime() - ts0.getTime()).toBe(15 * 60_000);
    });

    it('auto-stops after simulatedTickCountMax ticks', () => {
      const gen = new IntervalTimerEventGenerator(1000, 'SIM_STOP', {
        simulatedStartDate: new Date(),
        simulatedTickDurationInMs: 10,
        simulatedTickCountMax: 3,
      });
      gen.start();
      clock.tick(1000);
      expect(publishEventStub.callCount).toBe(3);
    });

    it('uses simulatedTickDurationInMs as wall-clock interval not intervalInMs', () => {
      const gen = new IntervalTimerEventGenerator(60_000, 'WALL_CLOCK', {
        simulatedStartDate: new Date(),
        simulatedTickDurationInMs: 50,
        simulatedTickCountMax: 2,
      });
      gen.start();
      clock.tick(60);
      expect(publishEventStub.callCount).toBe(1);
      clock.tick(40);
      expect(publishEventStub.callCount).toBe(2);
    });

    it('defaults simulatedTickDurationInMs to intervalInMs when not provided', () => {
      const gen = new IntervalTimerEventGenerator(500, 'DEFAULT_TICK', {
        simulatedStartDate: new Date(),
        simulatedTickCountMax: 2,
      });
      gen.start();
      clock.tick(500);
      expect(publishEventStub.callCount).toBe(1);
      clock.tick(500);
      expect(publishEventStub.callCount).toBe(2);
    });

    it('defaults simulatedTickCountMax to 10 when not provided', () => {
      const gen = new IntervalTimerEventGenerator(1000, 'DEFAULT_MAX', {
        simulatedStartDate: new Date(),
        simulatedTickDurationInMs: 10,
      });
      gen.start();
      clock.tick(200);
      expect(publishEventStub.callCount).toBe(10);
    });
  });
});
