export { JustInWrapper } from './JustInWrapper';
export { JustInLite } from './JustInLite';

// Types users need to define their stuff
export type { JEvent } from './event/event.type';
export type {
  TaskRegistration,
  DecisionRuleRegistration,
  StepReturnResult,
  ExecuteStepReturn,
} from './handlers/handler.type';


/** Core logger utilities, re-exported for convenience. */
export { Log, setLogger, setLogLevels, logLevels, scopedLog } from "@just-in/core";
export type { Logger } from "@just-in/core";

/** User APIs commonly needed by event-driven apps. */
export { UserManager } from "@just-in/core";
export type { JUser, NewUserRecord } from "@just-in/core";
