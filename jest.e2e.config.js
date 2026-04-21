module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/.jest/setEnvVars.ts'],
  moduleFileExtensions: ['js', 'json', 'jsx', 'ts', 'tsx'],
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      { tsconfig: 'tsconfig.jest.json' },
    ],
  },
  testMatch: ['**/__tests__/**/*.e2e.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  collectCoverage: false,
  testTimeout: 30000,
};
