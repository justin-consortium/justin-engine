/**
 * Assertions for higher-level handler execution results.
 *
 * This is intentionally generic: different parts of engine may return
 * slightly different envelopes. We assert the common patterns that matter
 * in tests: whether an error exists, and whether the result indicates success.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

type AnyHandlerResult = {
  ok?: unknown;
  success?: unknown;
  status?: unknown;
  error?: unknown;
  errors?: unknown;
};

/**
 * Asserts that a handler result indicates success and has no error(s).
 */
export function expectHandlerOk(result: unknown): void {
  expect(result).toBeTruthy();
  expect(typeof result).toBe('object');

  const r = result as AnyHandlerResult;

  // Accept a few common conventions; you can tighten this later once
  // the engine result envelope is finalized.
  const hasOkTrue = r.ok === true;
  const hasSuccessTrue = r.success === true;
  const hasStatusSuccess = r.status === 'success';

  expect(hasOkTrue || hasSuccessTrue || hasStatusSuccess).toBe(true);

  expect(r.error ?? null).toBeNull();
  expect(r.errors ?? null).toBeNull();
}

/**
 * Asserts that a handler result indicates failure and contains an error.
 */
export function expectHandlerError(
  result: unknown,
  opts: { messageIncludes?: string } = {},
): void {
  expect(result).toBeTruthy();
  expect(typeof result).toBe('object');

  const r = result as AnyHandlerResult;

  const indicatesFailure =
    r.ok === false || r.success === false || r.status === 'error';

  expect(indicatesFailure).toBe(true);

  // Accept either `error` or `errors` shapes.
  const err = r.error ?? r.errors;
  expect(err).toBeTruthy();

  if (opts.messageIncludes) {
    const msg =
      typeof (err as any)?.message === 'string'
        ? (err as any).message
        : JSON.stringify(err);

    expect(msg).toContain(opts.messageIncludes);
  }
}
