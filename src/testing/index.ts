/**
 * Test utilities for @just-in/engine.
 *
 * Import via:
 *   import { ... } from '@just-in/engine/testing';
 *
 * Re-exports all `@just-in/core/testing` utilities so engine test files only
 * need a single testing import. Engine-specific additions (sandbox, factories,
 * assertions, register helpers) are layered on top.
 *
 * ⚠️  Intended for test environments only. Do not import in production code.
 */

// Core testing re-exported — makeTestJUser, makeTestNewUserRecord,
// makeCoreManagersSandbox, makeLoggerSandbox, silenceLogger,
// waitForCondition, withFakeTimers, expectOk, expectLog, etc.
export * from '@just-in/core/testing';

// Engine testkit
export * from './testkit';

// Engine helpers
export * from './helpers';
