import { createLogger } from '@just-in/core';
import type { IntervalTimerEventGeneratorOptions } from './types';
import { publishEvent } from './queue';

const Log = createLogger({
  context: { package: '@just-in/engine', component: 'timer' },
});

/**
 * Generates events on a fixed interval and publishes them to the event queue.
 *
 * Operates in two modes:
 *
 * **Real-time mode** (default): fires at the specified wall-clock interval,
 * publishing events with the current timestamp on each tick. Used for
 * production deployments where the engine runs continuously.
 *
 * **Simulated mode**: activated by providing `simulatedStartDate` in options.
 * Fires ticks at `simulatedTickDurationInMs` wall-clock speed, but each tick
 * publishes a `generatedTimestamp` advanced by `intervalInMs` from the
 * previous tick starting at `simulatedStartDate`. Stops automatically after
 * `simulatedTickCountMax` ticks. Use this for:
 * - Testing handler logic across a time series without waiting for real time
 * - Backfilling a participant's history from a past date
 *
 * @example
 * ```ts
 * // Real-time: publish a clock event every 15 minutes
 * engine.createIntervalTimerEventGenerator('CLOCK_EVENT', 15 * 60 * 1000);
 *
 * // Simulated: replay 7 days of 15-minute ticks at 10ms per tick
 * engine.createIntervalTimerEventGenerator('CLOCK_EVENT', 15 * 60 * 1000, {
 *   simulatedStartDate: new Date('2024-01-01T00:00:00Z'),
 *   simulatedTickDurationInMs: 10,
 *   simulatedTickCountMax: 7 * 24 * 4,
 * });
 * ```
 */
class IntervalTimerEventGenerator {
  private _intervalId: NodeJS.Timeout | null = null;
  private _simulatedStartDate: Date | null = null;
  private _useSimulatedMode: boolean = false;
  private _simulatedTickDurationInMs: number = 10;
  private _simulatedTickCountMax: number = 10;
  private _simulatedTickCount: number = 0;

  constructor(
    private readonly _intervalInMs: number,
    private readonly _eventTypeName: string,
    private readonly _options: IntervalTimerEventGeneratorOptions = {},
  ) {
    if (_intervalInMs <= 0) {
      throw new Error('IntervalTimerEventGenerator: interval must be greater than 0.');
    }
    if (!_eventTypeName || _eventTypeName.trim() === '') {
      throw new Error('IntervalTimerEventGenerator: event type name is required.');
    }

    if (_options.simulatedStartDate) {
      this._simulatedStartDate = new Date(_options.simulatedStartDate);
      this._useSimulatedMode = true;
      this._simulatedTickDurationInMs =
        _options.simulatedTickDurationInMs ?? _intervalInMs;
      this._simulatedTickCountMax = _options.simulatedTickCountMax ?? 10;
    }
  }

  /**
   * Starts the interval timer.
   *
   * In real-time mode the timer runs indefinitely until {@link stop} is called.
   * In simulated mode the timer stops automatically after
   * `simulatedTickCountMax` ticks.
   */
  public start(): void {
    const wallClockInterval = this._useSimulatedMode
      ? this._simulatedTickDurationInMs
      : this._intervalInMs;

    this._intervalId = setInterval(() => {
      let eventTimestamp: Date;

      if (this._useSimulatedMode) {
        eventTimestamp = new Date(
          this._simulatedStartDate!.getTime() +
          this._simulatedTickCount * this._intervalInMs,
        );
        this._simulatedTickCount++;

        if (this._simulatedTickCount >= this._simulatedTickCountMax) {
          this.stop();
        }
      } else {
        eventTimestamp = new Date();
      }

      publishEvent(this._eventTypeName, eventTimestamp).catch((error) => {
        Log.error('Failed to publish timer event.', {
          eventTypeName: this._eventTypeName,
          eventTimestamp,
          error,
        });
      });
    }, wallClockInterval);
  }

  /**
   * Stops the interval timer.
   *
   * Safe to call when the timer is not running. Called automatically in
   * simulated mode after `simulatedTickCountMax` ticks.
   */
  public stop(): void {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }
}

export { IntervalTimerEventGenerator };
