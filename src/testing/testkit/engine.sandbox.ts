import sinon, { type SinonSandbox } from 'sinon';

import { makeLoggerSandbox, type LoggerSandbox } from '@just-in/core/testing';

import { reset } from '../helpers/reset';
import { resetRegisterCounters } from '../helpers/register';

type EngineSandbox = {
  sb: SinonSandbox;
  logs: LoggerSandbox;
  reset(): Promise<void>;
  restore(): Promise<void>;
};

function makeEngineSandbox(): EngineSandbox {
  const sb = sinon.createSandbox();
  const logs = makeLoggerSandbox({ ctx: { package: '@just-in/engine' } });

  return {
    sb,
    logs,
    async reset() {
      resetRegisterCounters();
      await reset();
    },
    async restore() {
      try {
        sb.restore();
        logs.restore();
      } finally {
        resetRegisterCounters();
        await reset();
      }
    },
  };
}

export { makeEngineSandbox };
export type { EngineSandbox };
