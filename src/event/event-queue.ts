import DataManager, {
  ChangeListenerManager,
  UserManager,
  CollectionChangeType,
  createLogger,
  JUser,
} from '@just-in/core';
import { JEvent } from './event.type';

import { executeTask, getTaskByName } from '../handlers/task.manager';
import { executeDecisionRule, getDecisionRuleByName } from '../handlers/decision-rule.manager';
import { EventHandlerManager } from './event-handler-manager';
import { executeEventForUsers } from './event-executor';
import { ARCHIVED_EVENTS, EVENT_QUEUE } from '../constants';

const dataManager = DataManager.getInstance();
const clm = ChangeListenerManager.getInstance();
const eventHandlerManager = EventHandlerManager.getInstance();

let isProcessingQueue = false;
let shouldProcessQueue = true;

// Package-local logger for the event queue module
const Log = createLogger({
  context: {
    component: 'event-queue',
  },
});

/**
 * Triggers an event by creating an instance in the `EVENTS_QUEUE`.
 */
const publishEvent = async (
  eventType: string,
  generatedTimestamp: Date,
  eventDetails?: Record<string, any>,
): Promise<void> => {
  try {
    if (!eventHandlerManager.hasHandlersForEventType(eventType)) {
      Log.warn('No handlers found for event type; skipping event publication.', {
        eventType,
      });
      return;
    }

    const eventInstance: JEvent = {
      eventType,
      generatedTimestamp,
      publishedTimestamp: new Date(),
      eventDetails,
    };

    const addedEvent = (await dataManager.addItemToCollection(
      EVENT_QUEUE,
      eventInstance,
    )) as JEvent;

    Log.info('Published event.', {
      eventType: eventInstance.eventType,
      eventId: addedEvent.id,
      event: addedEvent,
    });
  } catch (error) {
    Log.error('Failed to publish event.', {
      eventType,
      error,
    });
    throw error;
  }
};

/**
 * Processes events in the `EVENTS_QUEUE`.
 */
const processEventQueue = async (): Promise<void> => {
  if (isProcessingQueue) {
    Log.info('Event queue processing already in progress; skipping new run.');
    return;
  }

  isProcessingQueue = true;

  try {
    Log.debug('Starting event queue processing.');

    while (shouldProcessQueue) {
      const users = UserManager.getAllUsers();
      const events = (await dataManager.getAllInCollection(EVENT_QUEUE)) as JEvent[];

      if (!events || events.length === 0) {
        Log.debug('No events left in the queue; pausing processing.');
        break;
      }

      for (const event of events) {
        Log.debug('Processing event for users.', {
          event,
          userCount: users.length,
        });

        await executeEventForUsers(event, users, eventHandlerManager);

        try {
          await archiveEvent(event);
        } catch (error) {
          Log.error('Failed to archive event after processing.', {
            event,
            error,
          });
        }
      }
    }

    Log.debug('Finished processing event queue.');
  } catch (error) {
    Log.error('Error during event queue processing.', { error });
  } finally {
    isProcessingQueue = false;
  }
};

/**
 * Sets up a listener for the `EVENTS_QUEUE` collection.
 */
const setupEventQueueListener = async (): Promise<void> => {
  try {
    Log.debug('Setting up event queue listener.');

    if (clm.hasChangeListener(EVENT_QUEUE, CollectionChangeType.INSERT)) {
      Log.info('Event queue listener already set up; skipping setup.');
      return;
    }

    clm.addChangeListener(EVENT_QUEUE, CollectionChangeType.INSERT, async () => {
      if (shouldProcessQueue) {
        Log.debug('New event detected in EVENTS_QUEUE; triggering processing.');
        await processEventQueue();
      }
    });

    // Kick off processing once on startup as well.
    await processEventQueue();

    Log.debug('Event queue listener set up successfully.');
  } catch (error) {
    Log.error('Error setting up event queue listener.', { error });
  }
};

/**
 * Processes assignments (tasks or decision rules) for an event and user.
 *
 * NOTE: This helper is currently unused by processEventQueue, but kept for
 * potential future refactors.
 */
const processHandlers = async (event: JEvent, user: JUser): Promise<void> => {
  for (const handlerName of eventHandlerManager.getHandlersForEventType(event.eventType)) {
    try {
      const task = getTaskByName(handlerName);
      if (task) {
        await executeTask(task, event, user);
        continue;
      }

      const decisionRule = getDecisionRuleByName(handlerName);
      if (decisionRule) {
        await executeDecisionRule(decisionRule, event, user);
        continue;
      }

      Log.warn('Handler not found for event; skipping.', {
        handlerName,
        event,
      });
    } catch (error) {
      Log.error('Error processing assignment for event and user.', {
        handlerName,
        event,
        user,
        error,
      });
    }
  }
};

const processExecutionLifecycle = async (
  handlerName: string,
  event: JEvent,
  functionName: 'beforeExecution' | 'afterExecution',
): Promise<void> => {
  try {
    const task = getTaskByName(handlerName);
    if (task && typeof task[functionName] === 'function') {
      await task[functionName](event);
      return;
    }

    const decisionRule = getDecisionRuleByName(handlerName);
    if (decisionRule && typeof decisionRule[functionName] === 'function') {
      await decisionRule[functionName](event);
      return;
    }

    Log.debug('Lifecycle function not found for handler.', {
      functionName,
      handlerName,
      event,
    });
  } catch (error) {
    Log.error('Error executing lifecycle function for handler.', {
      functionName,
      handlerName,
      event,
      error,
    });
  }
};

/**
 * Archives a processed event by moving it from `EVENTS_QUEUE` to `ARCHIVED_EVENTS`.
 */
const archiveEvent = async (event: JEvent): Promise<void> => {
  try {
    Log.debug('Archiving event.', { event });

    await dataManager.addItemToCollection(ARCHIVED_EVENTS, event);

    if (event.id) {
      await dataManager.removeItemFromCollection(EVENT_QUEUE, event.id);
    } else {
      Log.error('Event has no ID; skipping removal from EVENTS_QUEUE.', {
        event,
      });
    }

    Log.debug('Event archived successfully.', { event });
  } catch (error) {
    Log.error('Failed to archive event.', { event, error });
    throw error;
  }
};

/**
 * Stops the event queue processing.
 */
const stopEventQueueProcessing = (): void => {
  shouldProcessQueue = false;
  clm.removeChangeListener(EVENT_QUEUE, CollectionChangeType.INSERT);
  Log.info('Event queue processing stopped.');
};

/**
 * Starts the event queue processing.
 */
const startEventQueueProcessing = async (): Promise<void> => {
  await setupEventQueueListener();
  shouldProcessQueue = true;
  Log.debug('Event queue processing started.');
};

/**
 * Returns true if the event queue is running.
 */
function isRunning(): boolean {
  return shouldProcessQueue;
}

/**
 * Returns true if the event queue is empty.
 */
async function queueIsEmpty(): Promise<boolean> {
  const events = await dataManager.getAllInCollection(EVENT_QUEUE);
  return !events || events.length === 0;
}

/**
 * Sets the shouldProcessQueue flag.
 */
const setShouldProcessQueue = (shouldProcess: boolean): void => {
  shouldProcessQueue = shouldProcess;
};

export {
  setShouldProcessQueue,
  queueIsEmpty,
  isRunning,
  startEventQueueProcessing,
  stopEventQueueProcessing,
  setupEventQueueListener,
  processEventQueue,
  publishEvent,
};
