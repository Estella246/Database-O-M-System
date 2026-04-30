/** @type {import('jest').Config} */
const config = {
  verbose: true,
  testMatch: [
    "**/__tests__/**/*.test.js",
    "**/*.test.js"
  ],
  testEnvironment: "node",
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/../$1"
  }
};

module.exports = config;