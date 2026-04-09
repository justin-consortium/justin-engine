import type { JUser } from '@just-in/core';
import type { JEvent } from '../../event';

// ---------------------------------------------------------------------------
// Event factory
// ---------------------------------------------------------------------------

/**
 * Creates a test {@link JEvent} with sensible defaults and optional overrides.
 *
 * Defaults:
 * - `eventType`: `'TEST_EVENT'`
 * - `generatedTimestamp`: current time
 * - `eventDetails`: `{}`
 *
 * @param overrides - Optional fields to merge onto the default event shape.
 *
 * @example
 * ```ts
 * const event = makeEvent();
 * const typedEvent = makeEvent({ eventType: 'CLOCK_EVENT', eventDetails: { trigger: 'test' } });
 * const timedEvent = makeEvent({ generatedTimestamp: new Date('2024-01-01T08:00:00Z') });
 * ```
 */
function makeEvent(overrides: Partial<JEvent> = {}): JEvent {
  return {
    eventType: overrides.eventType ?? 'TEST_EVENT',
    generatedTimestamp: overrides.generatedTimestamp ?? new Date(),
    eventDetails: overrides.eventDetails ?? {},
    ...(overrides.id !== undefined && { id: overrides.id }),
    ...(overrides.publishedTimestamp !== undefined && {
      publishedTimestamp: overrides.publishedTimestamp,
    }),
  };
}

// ---------------------------------------------------------------------------
// User factory
// ---------------------------------------------------------------------------

/**
 * Creates a test {@link JUser} with the engine's expected `attributes` nesting.
 *
 * Defaults:
 * - `id`: `'u1'`
 * - `uniqueIdentifier`: same as `id`
 * - `attributes`: `{}`
 *
 * Application-level fields should be nested under `attributes` to match the
 * shape the engine and handlers expect:
 * ```ts
 * makeEngineTestUser({
 *   id: 'u1',
 *   uniqueIdentifier: 'alice',
 *   attributes: {
 *     demographics: { timeZone: 'America/New_York' },
 *     customFields: { RecentWearDays: [] },
 *   },
 * });
 * ```
 *
 * For tests that only need a minimal user with no attributes, use the
 * `makeTestJUser` factory from `@just-in/core/testing` instead.
 *
 * @param overrides - Optional fields to merge onto the default user shape.
 */
function makeEngineTestUser(
  overrides: Partial<JUser & { attributes: Record<string, unknown> }> = {},
): JUser {
  const id = overrides.id ?? 'u1';
  const uniqueIdentifier = overrides.uniqueIdentifier ?? id;
  const { id: _id, uniqueIdentifier: _uid, ...rest } = overrides as Record<string, unknown>;

  return {
    id,
    uniqueIdentifier,
    attributes: (rest['attributes'] as Record<string, unknown>) ?? {},
    ...rest,
  } as JUser;
}

export { makeEvent, makeEngineTestUser };
