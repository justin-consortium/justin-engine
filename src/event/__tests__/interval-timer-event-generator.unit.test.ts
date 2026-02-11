import sinon from 'sinon';
import { IntervalTimerEventGenerator } from '../interval-timer-event-generator';
import * as EventQueue from '../event-queue';
import type { IntervalTimerEventGeneratorOptions } from '../event.type';

describe('IntervalTimerEventGenerator', () => {
  const sb = sinon.createSandbox();

  let clock: sinon.SinonFakeTimers;
  let generator: IntervalTimerEventGenerator | undefined;
  let publishEventStub: sinon.SinonStub;

  beforeEach(() => {
    // Arrange
    clock = sb.useFakeTimers();
    publishEventStub = sb.stub(EventQueue, 'publishEvent');
  });

  afterEach(() => {
    // Arrange
    generator?.stop();
    clock.restore();
    sb.restore();
    generator = undefined;
  });

  describe('constructor', () => {
    it('should create instance with basic configuration', () => {
      // Arrange

      // Act
      generator = new IntervalTimerEventGenerator(1000, 'TEST_EVENT');

      // Assert
      expect(generator).toBeInstanceOf(IntervalTimerEventGenerator);
    });

    it('should create instance with simulated options', () => {
      // Arrange
      const options: IntervalTimerEventGeneratorOptions = {
        simulatedStartDate: new Date('2023-01-01T00:00:00Z'),
        simulatedTickDurationInMs: 50,
        simulatedTickCountMax: 5,
      };

      // Act
      generator = new IntervalTimerEventGenerator(1000, 'TEST_EVENT', options);

      // Assert
      expect(generator).toBeInstanceOf(IntervalTimerEventGenerator);
    });

    it('should use default simulated options when not provided', () => {
      // Arrange
      const options: IntervalTimerEventGeneratorOptions = {
        simulatedStartDate: new Date('2023-01-01T00:00:00Z'),
      };

      // Act
      generator = new IntervalTimerEventGenerator(1000, 'TEST_EVENT', options);

      // Assert
      expect(generator).toBeInstanceOf(IntervalTimerEventGenerator);
    });

    it('should throw error when interval is zero', () => {
      // Arrange / Act / Assert
      expect(() => {
        new IntervalTimerEventGenerator(0, 'TEST_EVENT');
      }).toThrow('Interval must be greater than 0');
    });

    it('should throw error when interval is negative', () => {
      // Arrange / Act / Assert
      expect(() => {
        new IntervalTimerEventGenerator(-100, 'TEST_EVENT');
      }).toThrow('Interval must be greater than 0');
    });

    it('should throw error when event type name is empty string', () => {
      // Arrange / Act / Assert
      expect(() => {
        new IntervalTimerEventGenerator(1000, '');
      }).toThrow('Event type name is required');
    });

    it('should throw error when event type name is whitespace only', () => {
      // Arrange / Act / Assert
      expect(() => {
        new IntervalTimerEventGenerator(1000, '   ');
      }).toThrow('Event type name is required');
    });

    it('should throw error when event type name is null', () => {
      // Arrange / Act / Assert
      expect(() => {
        new IntervalTimerEventGenerator(1000, null as any);
      }).toThrow('Event type name is required');
    });

    it('should throw error when event type name is undefined', () => {
      // Arrange / Act / Assert
      expect(() => {
        new IntervalTimerEventGenerator(1000, undefined as any);
      }).toThrow('Event type name is required');
    });

    it('should accept valid event type name with leading/trailing whitespace', () => {
      // Arrange

      // Act
      generator = new IntervalTimerEventGenerator(1000, '  TEST_EVENT  ');

      // Assert
      expect(generator).toBeInstanceOf(IntervalTimerEventGenerator);
    });
  });

  describe('start', () => {
    it('should start timer and publish events at regular intervals', () => {
      // Arrange
      generator = new IntervalTimerEventGenerator(1000, 'TEST_EVENT');

      // Act
      generator.start();

      clock.tick(1000);
      clock.tick(1000);

      // Assert
      expect(publishEventStub.calledTwice).toBe(true);

      expect(publishEventStub.firstCall.args[0]).toBe('TEST_EVENT');
      expect(publishEventStub.firstCall.args[1]).toBeInstanceOf(Date);

      expect(publishEventStub.secondCall.args[0]).toBe('TEST_EVENT');
      expect(publishEventStub.secondCall.args[1]).toBeInstanceOf(Date);
    });

    it('should use current timestamp for real-time events', () => {
      // Arrange
      const startTime = new Date('2023-01-01T12:00:00Z');
      clock.setSystemTime(startTime);

      generator = new IntervalTimerEventGenerator(1000, 'TEST_EVENT');

      // Act
      generator.start();
      clock.tick(1000);

      // Assert
      expect(publishEventStub.calledOnce).toBe(true);

      const publishedTimestamp = publishEventStub.firstCall.args[1] as Date;
      expect(publishedTimestamp.getTime()).toBe(startTime.getTime() + 1000);
    });

    it('should handle simulated time progression correctly', () => {
      // Arrange
      const startDate = new Date('2023-01-01T00:00:00Z');
      const options: IntervalTimerEventGeneratorOptions = {
        simulatedStartDate: startDate,
        simulatedTickDurationInMs: 100,
        simulatedTickCountMax: 3,
      };

      generator = new IntervalTimerEventGenerator(1000, 'TEST_EVENT', options);

      // Act
      generator.start();

      clock.tick(100);

      clock.tick(100);

      clock.tick(100);

      // Assert
      expect(publishEventStub.calledThrice).toBe(true);

      let publishedTimestamp = publishEventStub.firstCall.args[1] as Date;
      expect(publishedTimestamp.getTime()).toBe(startDate.getTime());

      publishedTimestamp = publishEventStub.secondCall.args[1] as Date;
      expect(publishedTimestamp.getTime()).toBe(startDate.getTime() + 1000);

      publishedTimestamp = publishEventStub.thirdCall.args[1] as Date;
      expect(publishedTimestamp.getTime()).toBe(startDate.getTime() + 2000);
    });

    it('should stop automatically after reaching simulated tick count max', () => {
      // Arrange
      const options: IntervalTimerEventGeneratorOptions = {
        simulatedStartDate: new Date('2023-01-01T00:00:00Z'),
        simulatedTickDurationInMs: 100,
        simulatedTickCountMax: 2,
      };

      generator = new IntervalTimerEventGenerator(1000, 'TEST_EVENT', options);

      // Act
      generator.start();

      clock.tick(100);
      clock.tick(100);
      clock.tick(100);

      // Assert
      expect(publishEventStub.calledTwice).toBe(true);
    });

    it('should use default simulated tick count max when not specified', () => {
      // Arrange
      const options: IntervalTimerEventGeneratorOptions = {
        simulatedStartDate: new Date('2023-01-01T00:00:00Z'),
        simulatedTickDurationInMs: 100,
      };

      generator = new IntervalTimerEventGenerator(1000, 'TEST_EVENT', options);

      // Act
      generator.start();

      for (let i = 0; i < 10; i++) {
        clock.tick(100);
      }

      clock.tick(100);

      // Assert
      expect(publishEventStub.callCount).toBe(10);
    });

    it('should stop automatically at default simulated tick count max when simulated tick count max is not set', () => {
      // Arrange
      const options: IntervalTimerEventGeneratorOptions = {
        simulatedStartDate: new Date('2023-01-01T00:00:00Z'),
        simulatedTickDurationInMs: 100,
        simulatedTickCountMax: undefined,
      };

      generator = new IntervalTimerEventGenerator(1000, 'TEST_EVENT', options);

      // Act
      generator.start();

      for (let i = 0; i < 15; i++) {
        clock.tick(100);
      }

      // Assert
      expect(publishEventStub.callCount).toBe(10);
    });
  });

  describe('stop', () => {
    it('should stop the timer and prevent further events', () => {
      // Arrange
      generator = new IntervalTimerEventGenerator(1000, 'TEST_EVENT');
      generator.start();

      // Act
      clock.tick(1000);
      generator.stop();
      clock.tick(1000);

      // Assert
      expect(publishEventStub.calledOnce).toBe(true);
    });

    it('should handle stopping when not started', () => {
      // Arrange
      generator = new IntervalTimerEventGenerator(1000, 'TEST_EVENT');

      // Act / Assert
      expect(() => generator!.stop()).not.toThrow();
    });

    it('should handle stopping multiple times', () => {
      // Arrange
      generator = new IntervalTimerEventGenerator(1000, 'TEST_EVENT');
      generator.start();

      // Act / Assert
      generator.stop();
      expect(() => generator!.stop()).not.toThrow();
    });
  });

  describe('integration scenarios', () => {
    it('should handle rapid start/stop cycles', () => {
      // Arrange
      generator = new IntervalTimerEventGenerator(1000, 'TEST_EVENT');

      // Act
      generator.start();
      clock.tick(500);
      generator.stop();

      generator.start();
      clock.tick(1000);

      // Assert
      expect(publishEventStub.calledOnce).toBe(true);
    });

    it('should handle different interval durations', () => {
      // Arrange
      generator = new IntervalTimerEventGenerator(500, 'FAST_EVENT');

      // Act
      generator.start();
      clock.tick(500);
      clock.tick(500);

      // Assert
      expect(publishEventStub.calledTwice).toBe(true);
    });

    it('should handle simulated time with different intervals', () => {
      // Arrange
      const options: IntervalTimerEventGeneratorOptions = {
        simulatedStartDate: new Date('2023-01-01T00:00:00Z'),
        simulatedTickDurationInMs: 200,
        simulatedTickCountMax: 3,
      };

      generator = new IntervalTimerEventGenerator(3000, 'SLOW_EVENT', options);

      // Act
      generator.start();

      clock.tick(200);
      clock.tick(200);
      clock.tick(200);

      // Assert
      expect(publishEventStub.calledThrice).toBe(true);

      let timestamp = publishEventStub.firstCall.args[1] as Date;
      expect(timestamp.getTime()).toBe(new Date('2023-01-01T00:00:00Z').getTime());

      timestamp = publishEventStub.secondCall.args[1] as Date;
      expect(timestamp.getTime()).toBe(
        new Date('2023-01-01T00:00:00Z').getTime() + 3000,
      );

      timestamp = publishEventStub.thirdCall.args[1] as Date;
      expect(timestamp.getTime()).toBe(
        new Date('2023-01-01T00:00:00Z').getTime() + 6000,
      );
    });
  });

  describe('edge cases', () => {
    it('should handle very large interval duration', () => {
      // Arrange
      generator = new IntervalTimerEventGenerator(86400000, 'DAILY_EVENT');

      // Act
      generator.start();

      // Assert
      expect(publishEventStub.called).toBe(false);

      clock.tick(86400000);
      expect(publishEventStub.calledOnce).toBe(true);
    });

    it('should handle simulated start date in the past', () => {
      // Arrange
      const pastDate = new Date('2020-01-01T00:00:00Z');
      const options: IntervalTimerEventGeneratorOptions = {
        simulatedStartDate: pastDate,
        simulatedTickDurationInMs: 100,
        simulatedTickCountMax: 2,
      };

      generator = new IntervalTimerEventGenerator(1000, 'PAST_EVENT', options);

      // Act
      generator.start();
      clock.tick(100);

      // Assert
      expect(publishEventStub.calledOnce).toBe(true);

      const timestamp = publishEventStub.firstCall.args[1] as Date;
      expect(timestamp.getTime()).toBe(pastDate.getTime());
    });

    it('should handle simulated start date in the future', () => {
      // Arrange
      const futureDate = new Date('2030-01-01T00:00:00Z');
      const options: IntervalTimerEventGeneratorOptions = {
        simulatedStartDate: futureDate,
        simulatedTickDurationInMs: 100,
        simulatedTickCountMax: 2,
      };

      generator = new IntervalTimerEventGenerator(1000, 'FUTURE_EVENT', options);

      // Act
      generator.start();
      clock.tick(100);

      // Assert
      expect(publishEventStub.calledOnce).toBe(true);

      const timestamp = publishEventStub.firstCall.args[1] as Date;
      expect(timestamp.getTime()).toBe(futureDate.getTime());
    });
  });
});
