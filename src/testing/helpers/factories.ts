import type { JEvent } from '../../event/event.type';

export function makeEvent(
  overrides: Partial<JEvent> = {},
): JEvent {
  return {
    eventType: overrides.eventType ?? 'EV',
    generatedTimestamp: overrides.generatedTimestamp ?? new Date(),
    eventDetails: overrides.eventDetails ?? {},
  };
}
