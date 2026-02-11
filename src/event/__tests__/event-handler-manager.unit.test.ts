import { EventHandlerManager } from '../event-handler-manager';
import { withEngineSandbox } from '../../testing/helpers/with-engine-sandbox';

describe('EventHandlerManager', () => {
  const { engineSandbox, beforeEachHook, afterEachHook } = withEngineSandbox();

  beforeEach(async () => {
    await beforeEachHook();
  });

  afterEach(async () => {
    await afterEachHook();
  });

  it('returns the same singleton instance', () => {
    const a = EventHandlerManager.getInstance();
    const b = EventHandlerManager.getInstance();
    expect(a).toBe(b);
  });

  it('registers handlers and can read them back', async () => {
    const mgr = EventHandlerManager.getInstance();

    // Arrange
    const eventType = 'MY_EVENT';
    const handlerNames = ['handlerA', 'handlerB'];

    // Act
    await mgr.registerEventHandlers(eventType, handlerNames);

    // Assert
    expect(mgr.hasHandlersForEventType(eventType)).toBe(true);
    expect(mgr.getHandlersForEventType(eventType)).toEqual(handlerNames);
  });

  it('returns [] for unknown eventType', () => {
    const mgr = EventHandlerManager.getInstance();

    expect(mgr.hasHandlersForEventType('NOPE')).toBe(false);
    expect(mgr.getHandlersForEventType('NOPE')).toEqual([]);
  });

  it('throws when registering a duplicate eventType by default', async () => {
    const mgr = EventHandlerManager.getInstance();

    // Arrange
    const eventType = 'DUP_EVENT';
    await mgr.registerEventHandlers(eventType, ['handlerA']);

    // Act + Assert
    await expect(
      mgr.registerEventHandlers(eventType, ['handlerB']),
    ).rejects.toThrow('already registered');

    // Still the original mapping
    expect(mgr.getHandlersForEventType(eventType)).toEqual(['handlerA']);
  });

  it('overwrites existing handlers when overwriteExisting is true', async () => {
    const mgr = EventHandlerManager.getInstance();

    // Arrange
    const eventType = 'OVERWRITE_EVENT';
    await mgr.registerEventHandlers(eventType, ['handlerA']);

    // Act
    await mgr.registerEventHandlers(eventType, ['handlerB', 'handlerC'], true);

    // Assert
    expect(mgr.getHandlersForEventType(eventType)).toEqual([
      'handlerB',
      'handlerC',
    ]);
  });

  it('throws for invalid eventType', async () => {
    const mgr = EventHandlerManager.getInstance();

    // empty string
    await expect(
      mgr.registerEventHandlers('', ['handlerA']),
    ).rejects.toThrow('non-empty string');

    // non-string (runtime)
    await expect(
      mgr.registerEventHandlers((123 as unknown) as string, ['handlerA']),
    ).rejects.toThrow('non-empty string');
  });

  it('throws for invalid handlerNames', async () => {
    const mgr = EventHandlerManager.getInstance();

    await expect(
      mgr.registerEventHandlers('EVENT', []),
    ).rejects.toThrow('non-empty array of strings');

    await expect(
      mgr.registerEventHandlers('EVENT', (null as unknown) as string[]),
    ).rejects.toThrow('non-empty array of strings');

    await expect(
      mgr.registerEventHandlers('EVENT', ['ok', '']),
    ).rejects.toThrow('non-empty array of strings');

    await expect(
      mgr.registerEventHandlers(
        'EVENT',
        (['ok', 123] as unknown) as string[],
      ),
    ).rejects.toThrow('non-empty array of strings');
  });

  it('unregisters an existing mapping', async () => {
    const mgr = EventHandlerManager.getInstance();

    // Arrange
    await mgr.registerEventHandlers('EVENT', ['handlerA']);

    // Act
    mgr.unregisterEventHandlers('EVENT');

    // Assert
    expect(mgr.hasHandlersForEventType('EVENT')).toBe(false);
    expect(mgr.getHandlersForEventType('EVENT')).toEqual([]);
  });

  it('unregistering a missing mapping does not throw', () => {
    const mgr = EventHandlerManager.getInstance();

    expect(() => mgr.unregisterEventHandlers('MISSING')).not.toThrow();
    expect(mgr.hasHandlersForEventType('MISSING')).toBe(false);
  });

  it('clearEventHandlers removes all mappings', async () => {
    const mgr = EventHandlerManager.getInstance();

    // Arrange
    await mgr.registerEventHandlers('EVENT_A', ['h1']);
    await mgr.registerEventHandlers('EVENT_B', ['h2']);

    // Act
    mgr.clearEventHandlers();

    // Assert
    expect(mgr.hasHandlersForEventType('EVENT_A')).toBe(false);
    expect(mgr.hasHandlersForEventType('EVENT_B')).toBe(false);
    expect(mgr.getHandlersForEventType('EVENT_A')).toEqual([]);
    expect(mgr.getHandlersForEventType('EVENT_B')).toEqual([]);
  });

  it('reset helper clears the singleton and registry between tests', async () => {

    const mgr = EventHandlerManager.getInstance();
    await mgr.registerEventHandlers('EVENT', ['handlerA']);

    expect(mgr.hasHandlersForEventType('EVENT')).toBe(true);

    await engineSandbox.reset();

    const mgr2 = EventHandlerManager.getInstance();
    expect(mgr2.hasHandlersForEventType('EVENT')).toBe(false);
  });
});
