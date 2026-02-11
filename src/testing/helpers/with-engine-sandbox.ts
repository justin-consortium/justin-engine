import { makeEngineSandbox, type EngineSandbox } from '../testkit/engine.sandbox';

/**
 * Standard engine test harness wrapper.
 * Keeps sandbox lifecycle consistent across unit/integration suites.
 */
export function withEngineSandbox(): {
  engineSandbox: EngineSandbox;
  beforeEachHook: () => Promise<void>;
  afterEachHook: () => Promise<void>;
} {
  const engineSandbox = makeEngineSandbox();

  return {
    engineSandbox,
    beforeEachHook: async () => {
      await engineSandbox.reset();
    },
    afterEachHook: async () => {
      await engineSandbox.restore();
    },
  };
}
