import type { EngineSandbox } from '../../testing';
import { makeEngineSandbox } from '../../testing';
import { EventHandlerManager } from '../manager';

describe('event/manager — unit test', () => {
  let engineSandbox: EngineSandbox;
  let mgr: EventHandlerManager;

  beforeEach(() => {
    engineSandbox = makeEngineSandbox();
    mgr = EventHandlerManager.getInstance();
  });

  afterEach(() => engineSandbox.restore());

  describe('getInstance', () => {
    it('returns the same instance on repeated calls', () => {
      expect(EventHandlerManager.getInstance()).toBe(EventHandlerManager.getInstance());
    });

    it('returns the same instance retrieved in beforeEach', () => {
      expect(EventHandlerManager.getInstance()).toBe(mgr);
    });
  });

  describe('registerEventHandlers', () => {
    it('registers handlers retrievable by event type', async () => {
      await mgr.registerEventHandlers('MY_EVENT', ['task1', 'rule1']);
      expect(mgr.getHandlersForEventType('MY_EVENT')).toEqual(['task1', 'rule1']);
    });

    it('preserves handler registration order', async () => {
      await mgr.registerEventHandlers('ORDER_EVENT', ['first', 'second', 'third']);
      expect(mgr.getHandlersForEventType('ORDER_EVENT')).toEqual(['first', 'second', 'third']);
    });

    it('throws when event type is already registered and overwriteExisting is false', async () => {
      await mgr.registerEventHandlers('DUP_EVENT', ['h1']);
      await expect(mgr.registerEventHandlers('DUP_EVENT', ['h2'])).rejects.toThrow('"DUP_EVENT" is already registered');
    });

    it('overwrites an existing registration when overwriteExisting is true', async () => {
      await mgr.registerEventHandlers('OW_EVENT', ['old']);
      await mgr.registerEventHandlers('OW_EVENT', ['new1', 'new2'], true);
      expect(mgr.getHandlersForEventType('OW_EVENT')).toEqual(['new1', 'new2']);
    });

    it('throws when event type is an empty string', async () => {
      await expect(mgr.registerEventHandlers('', ['h1'])).rejects.toThrow('non-empty string');
    });

    it('throws when event type is not a string', async () => {
      await expect(mgr.registerEventHandlers(null as unknown as string, ['h1'])).rejects.toThrow('non-empty string');
    });

    it('throws when handler names array is empty', async () => {
      await expect(mgr.registerEventHandlers('EV', [])).rejects.toThrow('non-empty array');
    });

    it('throws when handler names array contains a blank string', async () => {
      await expect(mgr.registerEventHandlers('EV', ['valid', '  '])).rejects.toThrow('non-empty array');
    });

    it('throws when handler names array contains a non-string entry', async () => {
      await expect(mgr.registerEventHandlers('EV', [null as unknown as string])).rejects.toThrow('non-empty array');
    });

    it('logs an error when registration fails due to duplicate', async () => {
      await mgr.registerEventHandlers('LOG_EV', ['h1']);
      await expect(mgr.registerEventHandlers('LOG_EV', ['h2'])).rejects.toThrow();
      const errorLogs = engineSandbox.logs.findByMessage('already registered');
      expect(errorLogs).toHaveLength(1);
      expect(errorLogs[0].entry.severity).toBe('ERROR');
    });
  });

  describe('unregisterEventHandlers', () => {
    it('removes a registered event type', async () => {
      await mgr.registerEventHandlers('TO_REMOVE', ['h1']);
      mgr.unregisterEventHandlers('TO_REMOVE');
      expect(mgr.hasHandlersForEventType('TO_REMOVE')).toBe(false);
    });

    it('does not throw when event type is not registered', () => {
      expect(() => mgr.unregisterEventHandlers('GHOST')).not.toThrow();
    });

    it('logs a warning when event type is not registered', () => {
      mgr.unregisterEventHandlers('GHOST');
      const warnLogs = engineSandbox.logs.findByMessage('not found in registry');
      expect(warnLogs).toHaveLength(1);
      expect(warnLogs[0].entry.severity).toBe('WARNING');
    });
  });

  describe('hasHandlersForEventType', () => {
    it('returns false before registration', () => {
      expect(mgr.hasHandlersForEventType('NEVER_REGISTERED')).toBe(false);
    });

    it('returns true after registration', async () => {
      await mgr.registerEventHandlers('CHECK_ME', ['h1']);
      expect(mgr.hasHandlersForEventType('CHECK_ME')).toBe(true);
    });

    it('returns false after unregistering', async () => {
      await mgr.registerEventHandlers('THEN_REMOVED', ['h1']);
      mgr.unregisterEventHandlers('THEN_REMOVED');
      expect(mgr.hasHandlersForEventType('THEN_REMOVED')).toBe(false);
    });
  });

  describe('getHandlersForEventType', () => {
    it('returns an empty array for an unregistered event type', () => {
      expect(mgr.getHandlersForEventType('NOT_THERE')).toEqual([]);
    });

    it('does not throw for an unregistered event type', () => {
      expect(() => mgr.getHandlersForEventType('NOT_THERE')).not.toThrow();
    });

    it('logs a warning for an unregistered event type', () => {
      mgr.getHandlersForEventType('MISSING');
      const warnLogs = engineSandbox.logs.findByMessage('No handlers found');
      expect(warnLogs).toHaveLength(1);
    });

    it('returns a copy — mutating the result does not affect the registry', async () => {
      await mgr.registerEventHandlers('IMMUTABLE', ['h1', 'h2']);
      const handlers = mgr.getHandlersForEventType('IMMUTABLE');
      handlers.push('h3');
      expect(mgr.getHandlersForEventType('IMMUTABLE')).toEqual(['h1', 'h2']);
    });
  });

  describe('clearEventHandlers', () => {
    it('removes all registered event types', async () => {
      await mgr.registerEventHandlers('A', ['h1']);
      await mgr.registerEventHandlers('B', ['h2']);
      mgr.clearEventHandlers();
      expect(mgr.hasHandlersForEventType('A')).toBe(false);
      expect(mgr.hasHandlersForEventType('B')).toBe(false);
    });

    it('is safe to call when the registry is already empty', () => {
      expect(() => mgr.clearEventHandlers()).not.toThrow();
    });

    it('allows re-registration after clearing', async () => {
      await mgr.registerEventHandlers('C', ['h1']);
      mgr.clearEventHandlers();
      await expect(mgr.registerEventHandlers('C', ['h2'])).resolves.toBeUndefined();
      expect(mgr.getHandlersForEventType('C')).toEqual(['h2']);
    });
  });

  describe('test isolation', () => {
    it('does not see registrations from other tests', () => {
      expect(mgr.hasHandlersForEventType('MY_EVENT')).toBe(false);
      expect(mgr.hasHandlersForEventType('DUP_EVENT')).toBe(false);
    });
  });
});
