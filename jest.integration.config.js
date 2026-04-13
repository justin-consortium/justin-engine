module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/.jest/setEnvVars.ts'],
  moduleFileExtensions: ['js', 'json', 'jsx', 'ts', 'tsx'],
  transformIgnorePatterns: ['/node_modules/(?!@just-in/core)'],
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      { tsconfig: 'tsconfig.jest.json' },
    ],
  },
  testMatch: ['**/__tests__/**/*.integration.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  collectCoverage: false,
  testTimeout: 30000,
};
