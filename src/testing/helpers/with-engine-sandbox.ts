import { makeEngineSandbox } from '../testkit/engine-sandbox';
import type { EngineSandbox } from '../testkit/engine-sandbox';

/**
 * Standard engine test harness for suites that cannot use the inline
 * `beforeEach(() => { engineSandbox = makeEngineSandbox(); })` pattern —
 * for example, suites that need to reference `engineSandbox` outside of
 * `beforeEach` for stub setup.
 *
 * Returns lifecycle hooks that create a fresh sandbox before each test and
 * restore it after. The `engineSandbox` reference is updated on every
 * `beforeEachHook` call so it is always current.
 *
 * Prefer the direct pattern in most cases:
 * ```ts
 * let engineSandbox: EngineSandbox;
 * beforeEach(() => { engineSandbox = makeEngineSandbox(); });
 * afterEach(() => engineSandbox.restore());
 * ```
 *
 * Use `withEngineSandbox` when you need the sandbox reference available
 * at module scope (e.g. for TypeScript variable declarations outside hooks).
 *
 * @example
 * ```ts
 * const { sandbox, beforeEachHook, afterEachHook } = withEngineSandbox();
 * beforeEach(beforeEachHook);
 * afterEach(afterEachHook);
 *
 * it('asserts on logs', () => {
 *   sandbox().logs.findByMessage('...');
 * });
 * ```
 */
function withEngineSandbox(): {
  sandbox: () => EngineSandbox;
  beforeEachHook: () => void;
  afterEachHook: () => void;
} {
  let current: EngineSandbox | null = null;

  return {
    sandbox: () => {
      if (!current) throw new Error('withEngineSandbox: sandbox not initialized — call beforeEachHook first.');
      return current;
    },
    beforeEachHook: () => {
      current = makeEngineSandbox();
    },
    afterEachHook: () => {
      current?.restore();
      current = null;
    },
  };
}

export { withEngineSandbox };
export type { EngineSandbox };
