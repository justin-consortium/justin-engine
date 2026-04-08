import {
  DataManager,
  ChangeListenerManager,
  UserManager,
  CollectionChangeType,
  createLogger,
} from '@just-in/core';
import type { JUser } from '@just-in/core';
import type { JEvent } from './types';
import { EventHandlerManager } from './manager';
import { executeEventForUsers } from './executor';
import { ARCHIVED_EVENTS, EVENT_QUEUE } from '../constants';

const Log = createLogger({
  context: { package: '@just-in/engine', component: 'event-queue' },
});

const _dm = DataManager.getInstance();
const _clm = ChangeListenerManager.getInstance();
const _eventHandlerManager = EventHandlerManager.getInstance();

let _isProcessingQueue = false;
let _shouldProcessQueue = true;

/**
 * Publishes an event by inserting it into the `event_queue` collection.
 *
 * Silently skips publication if no handlers are registered for the event type
 * — avoids polluting the queue with events that cannot be processed.
 *
 * The change stream listener wired by {@link setupEventQueueListener} will
 * pick up the insert and trigger {@link processEventQueue} automatically.
 *
 * @param eventType          - The registered event type name.
 * @param generatedTimestamp - The logical event timestamp.
 * @param eventDetails       - Optional payload forwarded to handlers.
 * @throws If DataManager returns a non-ok result or throws.
 */
const publishEvent = async (
  eventType: string,
  generatedTimestamp: Date,
  eventDetails?: Record<string, unknown>,
): Promise<void> => {
  try {
    if (!_eventHandlerManager.hasHandlersForEventType(eventType)) {
      Log.warn('No handlers registered for event type; skipping publication.', { eventType });
      return;
    }

    const eventInstance: JEvent = {
      eventType,
      generatedTimestamp,
      publishedTimestamp: new Date(),
      eventDetails,
    };

    const result = await _dm.addItemToCollection(EVENT_QUEUE, eventInstance);

    if (!result.ok) {
      const reason = result.failures[0]?.reason ?? 'unknown';
      throw new Error(`publishEvent: DataManager failure — ${reason}`);
    }

    Log.info('Event published.', {
      eventType,
      eventId: result.successes[0]?.id,
    });
  } catch (error) {
    Log.error('Failed to publish event.', { eventType, error });
    throw error;
  }
};

/**
 * Drains the event queue — fetches all pending events, executes them against
 * all current users via {@link executeEventForUsers}, then archives each one.
 *
 * **Re-entrant guard:** if a processing run is already in flight, subsequent
 * calls return immediately. The in-flight run will drain the queue fully.
 *
 * **Processing flag:** if {@link stopEventQueueProcessing} has been called,
 * the loop exits after the current batch. Call {@link startEventQueueProcessing}
 * to re-enable.
 *
 * Archive failures are caught and logged per-event — a failure to archive one
 * event does not prevent remaining events from being processed.
 */
const processEventQueue = async (): Promise<void> => {
  if (_isProcessingQueue) {
    Log.debug('Queue processing already in progress; skipping.');
    return;
  }

  _isProcessingQueue = true;

  try {
    Log.debug('Starting event queue processing.');

    while (_shouldProcessQueue) {
      const users = UserManager.getAllUsers() as JUser[];
      const events = await _dm.getAllInCollection<JEvent>(EVENT_QUEUE);

      if (!events || events.length === 0) {
        Log.debug('Queue empty; stopping processing loop.');
        break;
      }

      for (const event of events) {
        Log.debug('Processing event.', { eventType: event.eventType, userCount: users.length });

        await executeEventForUsers(event, users, _eventHandlerManager);

        try {
          await _archiveEvent(event);
        } catch (error) {
          Log.error('Failed to archive event after processing.', {
            eventType: event.eventType,
            eventId: event.id,
            error,
          });
        }
      }
    }

    Log.debug('Event queue processing complete.');
  } catch (error) {
    Log.error('Unexpected error during queue processing.', { error });
  } finally {
    _isProcessingQueue = false;
  }
};

/**
 * Wires a change stream listener on `event_queue` so that any INSERT
 * automatically triggers {@link processEventQueue}. Also kicks off an
 * initial drain on setup.
 *
 * Idempotent — safe to call more than once. Skips setup if the listener
 * is already wired.
 */
const setupEventQueueListener = async (): Promise<void> => {
  try {
    if (_clm.hasChangeListener(EVENT_QUEUE, CollectionChangeType.INSERT)) {
      Log.debug('Event queue listener already set up; skipping.');
      return;
    }

    _clm.addChangeListener(EVENT_QUEUE, CollectionChangeType.INSERT, async () => {
      if (_shouldProcessQueue) {
        Log.debug('Insert detected in event_queue; triggering processing.');
        await processEventQueue();
      }
    });

    await processEventQueue();
    Log.debug('Event queue listener wired.');
  } catch (error) {
    Log.error('Error setting up event queue listener.', { error });
  }
};

/**
 * Starts event queue processing by wiring the change listener and setting
 * the processing flag.
 *
 * Call after `JustInEngine.init()` to begin consuming events.
 */
const startEventQueueProcessing = async (): Promise<void> => {
  _shouldProcessQueue = true;
  await setupEventQueueListener();
  Log.debug('Event queue processing started.');
};

/**
 * Stops event queue processing and removes the change stream listener.
 *
 * In-flight processing completes before the loop exits. Call
 * {@link startEventQueueProcessing} to resume.
 */
const stopEventQueueProcessing = (): void => {
  _shouldProcessQueue = false;
  _clm.removeChangeListener(EVENT_QUEUE, CollectionChangeType.INSERT);
  Log.info('Event queue processing stopped.');
};

/**
 * Moves a processed event from `event_queue` to `archived_events`.
 * Throws on DataManager failure so the caller can log and continue.
 */
const _archiveEvent = async (event: JEvent): Promise<void> => {
  const addResult = await _dm.addItemToCollection(ARCHIVED_EVENTS, event);

  if (!addResult.ok) {
    throw new Error(
      `archiveEvent: failed to insert into archived_events — ${addResult.failures[0]?.reason ?? 'unknown'}`,
    );
  }

  if (event.id) {
    await _dm.removeItemFromCollection(EVENT_QUEUE, event.id);
  } else {
    Log.warn('Event has no id; cannot remove from event_queue.', { eventType: event.eventType });
  }
};

/** Returns `true` if queue processing is currently enabled. */
function isRunning(): boolean {
  return _shouldProcessQueue;
}

/** Returns `true` if the event queue collection is empty. */
async function queueIsEmpty(): Promise<boolean> {
  const events = await _dm.getAllInCollection(EVENT_QUEUE);
  return !events || events.length === 0;
}

/**
 * Overrides the `_shouldProcessQueue` flag directly.
 *
 * @internal — exported for use in `@just-in/engine/testing` only.
 */
const _setShouldProcessQueue = (value: boolean): void => {
  _shouldProcessQueue = value;
};

export {
  publishEvent,
  processEventQueue,
  setupEventQueueListener,
  startEventQueueProcessing,
  stopEventQueueProcessing,
  isRunning,
  queueIsEmpty,
  _setShouldProcessQueue,
};
