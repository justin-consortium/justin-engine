/* eslint-disable no-console */

beforeEach(() => {
  jest.spyOn(console, 'debug').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  (console.log as jest.Mock).mockRestore();
  (console.warn as jest.Mock).mockRestore();
  (console.error as jest.Mock).mockRestore();
});
