/**
 * An event instance that triggers the handler pipeline.
 *
 * Events are the entry point to the engine. When an event is published, the
 * engine looks up all handlers registered for `eventType` and runs them in
 * order — each handler sweeping across all users before the next handler
 * starts.
 *
 * In the DB-backed engine, events are persisted to the `event_queue`
 * collection and processed asynchronously via a change stream listener.
 * In the serverless engine, `publishEvent` executes the pipeline immediately
 * and synchronously — when the call resolves, all handlers have completed.
 *
 * The `id` field is assigned by the database on insert. It is present on
 * events read from the queue but absent on events constructed in memory.
 * Handler authors should treat `id` as optional.
 *
 * @example
 * ```ts
 * // Accessing event fields inside a handler
 * const shouldActivate = async (user: JUser, event: JEvent): Promise<StepReturnResult> => {
 *   const eventMinutes = getUtcMinutesFromTimestamp(event.generatedTimestamp);
 *   const trigger = event.eventDetails?.trigger;
 *   // ...
 * };
 * ```
 */
type JEvent = {
  /**
   * Database-assigned identifier. Present on events read from the
   * `event_queue` collection; absent on in-memory event objects.
   */
  id?: string;

  /**
   * The registered event type name. Must match a name passed to
   * `registerEventHandlers` exactly. The engine uses this to look up
   * the ordered handler array for this event.
   */
  eventType: string;

  /**
   * The logical timestamp of this event — when it was generated or
   * scheduled, not necessarily when it was processed. For clock-driven
   * events (e.g. a 15-minute Cloud Run trigger), this is the publish time
   * of the triggering message. Handler authors use this to compute
   * user-local times and decision points.
   */
  generatedTimestamp: Date;

  /**
   * The wall-clock time at which the event was inserted into the queue.
   * Set by the engine in `publishEvent`. Absent on serverless events which
   * are never persisted.
   */
  publishedTimestamp?: Date;

  /**
   * Optional arbitrary payload attached to the event. Forwarded to every
   * handler as part of the `JEvent` argument. Use this to pass invocation
   * context (e.g. `{ trigger: 'GCF Pub/Sub', messageId: '...' }`) to
   * handlers without adding fields to the event type itself.
   */
  eventDetails?: Record<string, unknown>;
};


/**
 * The input shape for constructing a new event. Identical to {@link JEvent}
 * but without the `id` field, which is assigned by the database on insert.
 *
 * Used internally by `publishEvent` — authors do not use this type directly.
 */
type RegisterJEvent = Omit<JEvent, 'id'>;


/**
 * Configuration options for {@link IntervalTimerEventGenerator}.
 *
 * All fields are optional. Omitting all of them runs the generator in
 * real-time mode, firing events at the specified wall-clock interval.
 *
 * Providing `simulatedStartDate` switches the generator to **simulated mode**,
 * which is useful for two scenarios:
 *
 * - **Testing:** run through a sequence of historical timestamps at
 *   accelerated wall-clock speed without waiting for real time to pass.
 * - **Backfill:** replay a time series of events from a past date to bring
 *   a study participant's state up to date.
 *
 * In simulated mode the generator fires `simulatedTickCountMax` ticks, each
 * at `simulatedTickDurationInMs` wall-clock milliseconds apart. Each tick
 * publishes an event with a `generatedTimestamp` advanced by `intervalInMs`
 * from the previous tick, starting at `simulatedStartDate`. The generator
 * stops automatically after `simulatedTickCountMax` ticks.
 *
 * @example
 * ```ts
 * // Real-time: fire every 15 minutes
 * engine.createIntervalTimerEventGenerator('CLOCK_EVENT', 15 * 60 * 1000);
 *
 * // Simulated: replay 7 days of 15-minute ticks at 10ms per tick
 * engine.createIntervalTimerEventGenerator('CLOCK_EVENT', 15 * 60 * 1000, {
 *   simulatedStartDate: new Date('2024-01-01T00:00:00Z'),
 *   simulatedTickDurationInMs: 10,
 *   simulatedTickCountMax: 7 * 24 * 4, // 7 days × 24 hours × 4 ticks/hour
 * });
 * ```
 */
type IntervalTimerEventGeneratorOptions = {
  /**
   * The historical date from which to start generating simulated timestamps.
   * Providing this field switches the generator into simulated mode.
   * Each tick advances the published `generatedTimestamp` by `intervalInMs`
   * from this starting point.
   */
  simulatedStartDate?: Date;

  /**
   * Wall-clock milliseconds between ticks in simulated mode.
   * Defaults to `intervalInMs` if not provided.
   * Set this lower than `intervalInMs` to fast-forward through time.
   */
  simulatedTickDurationInMs?: number;

  /**
   * Maximum number of ticks to fire in simulated mode before the generator
   * stops automatically. Defaults to `10` if not provided.
   */
  simulatedTickCountMax?: number;
};


export type { JEvent, RegisterJEvent, IntervalTimerEventGeneratorOptions };
