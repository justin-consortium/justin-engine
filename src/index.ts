// Engine entrypoints
export { JustInWrapper } from './JustInWrapper';
export { JustInLite } from './JustInLite';

// Types
export type { JEvent } from './event/event.type';
export type {
  TaskRegistration,
  DecisionRuleRegistration,
  StepReturnResult,
  ExecuteStepReturn,
} from './handlers/handler.type';

/**
 * Core logger utilities, re-exported for convenience so 3PDs don't have
 * to depend on @just-in/core directly if they don't want to.
 */
export { createLogger, configureLogger } from '@just-in/core';
export type {
  Logger,
  LoggerEntry,
  BaseSeverity,
  LoggerCallback,
  EmitFn,
  LoggerConfig,
} from '@just-in/core';

/** User APIs commonly needed by event-driven apps. */
export { UserManager } from '@just-in/core';
export type { JUser, NewUserRecord } from '@just-in/core';
