import { createLogger } from '@just-in/core';

const Log = createLogger({
  context: { package: '@just-in/engine', component: 'event-manager' },
});

/**
 * Registry that maps event type names to their ordered handler arrays.
 *
 * The engine's single source of truth for "which handlers run when this event
 * fires, and in what order." Both {@link JustIn} and {@link JustInServerless}
 * share this singleton — registrations made on either facade are visible to
 * the executor.
 *
 * Authors do not interact with `EventHandlerManager` directly. Use
 * `registerEventHandlers` on the engine facade instead.
 *
 * @internal
 */
class EventHandlerManager {
  private handlerMap: Map<string, string[]> = new Map();
  private static _instance: EventHandlerManager | null = null;

  private constructor() {}

  /**
   * Returns the singleton `EventHandlerManager` instance.
   *
   * The instance is shared across the entire process — both engine facades
   * read from and write to the same registry.
   */
  static getInstance(): EventHandlerManager {
    if (!EventHandlerManager._instance) {
      EventHandlerManager._instance = new EventHandlerManager();
    }
    return EventHandlerManager._instance;
  }

  /**
   * Registers an ordered array of handler names for an event type.
   *
   * The order of `handlerNames` is the execution order — each handler runs
   * its full user sweep before the next handler starts. Handlers that prepare
   * data (e.g. fetching Fitbit data and writing it onto `user.attributes`)
   * must appear before handlers that consume that data.
   *
   * @param eventType        - The event type name. Case-sensitive.
   * @param handlerNames     - Ordered array of registered task and decision
   *   rule names.
   * @param overwriteExisting - If `true`, replaces an existing registration.
   *   Defaults to `false`.
   * @throws If `eventType` is an empty string or not a string.
   * @throws If `handlerNames` is empty or contains a blank string.
   * @throws If `eventType` is already registered and `overwriteExisting` is
   *   `false`.
   */
  registerEventHandlers = async (
    eventType: string,
    handlerNames: string[],
    overwriteExisting: boolean = false,
  ): Promise<void> => {
    this._validate(eventType, handlerNames);

    if (this.hasHandlersForEventType(eventType) && !overwriteExisting) {
      Log.error('Event registration failed: already registered.', {
        eventType,
        handlerNames,
      });
      throw new Error(`Event "${eventType}" is already registered.`);
    }

    this.handlerMap.set(eventType, handlerNames);
    Log.info('Event registered.', { eventType, handlerNames });
  };

  /**
   * Removes the handler registration for an event type.
   *
   * Safe to call with an unregistered event type — logs a warning but does
   * not throw.
   *
   * @param eventType - The event type to unregister.
   */
  unregisterEventHandlers = (eventType: string): void => {
    if (this.hasHandlersForEventType(eventType)) {
      this.handlerMap.delete(eventType);
      Log.info('Event unregistered.', { eventType });
    } else {
      Log.warn('Unregister failed: event type not found in registry.', { eventType });
    }
  };

  /**
   * Returns the ordered handler names for an event type.
   *
   * Returns an empty array if the event type is not registered — does not
   * throw. Callers should check {@link hasHandlersForEventType} first if they
   * need to distinguish "not registered" from "registered with no handlers"
   * (the latter cannot occur — empty arrays are rejected by
   * {@link registerEventHandlers}).
   *
   * @param eventType - The event type to look up.
   */
  getHandlersForEventType = (eventType: string): string[] => {
    if (!this.hasHandlersForEventType(eventType)) {
      Log.warn('No handlers found for event type.', { eventType });
      return [];
    }
    return this.handlerMap.get(eventType) ?? [];
  };

  /**
   * Returns `true` if handlers are registered for the given event type.
   *
   * @param eventType - The event type to check.
   */
  hasHandlersForEventType = (eventType: string): boolean => {
    return this.handlerMap.has(eventType);
  };

  /**
   * Removes all event handler registrations.
   *
   * Called by the engine sandbox `reset()` between tests, and by
   * `JustInServerless.reset()` at the end of each invocation.
   */
  clearEventHandlers = (): void => {
    this.handlerMap.clear();
    Log.debug('All event handlers cleared.');
  };
  
  private _validate(eventType: string, handlerNames: string[]): void {
    if (!eventType || typeof eventType !== 'string') {
      Log.error('Invalid event type.', { eventType });
      throw new Error('Event type must be a non-empty string.');
    }

    if (
      !Array.isArray(handlerNames) ||
      handlerNames.length === 0 ||
      !handlerNames.every((h) => typeof h === 'string' && h.trim() !== '')
    ) {
      Log.error('Invalid handler names.', { eventType, handlerNames });
      throw new Error('Handler names must be a non-empty array of non-empty strings.');
    }
  }
}

export { EventHandlerManager };
