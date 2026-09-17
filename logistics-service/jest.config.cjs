// Source imports use NodeNext-style ".js" extensions on relative paths
// (e.g. "../Utils/StatusCode.js") even though the files on disk are
// ".ts" — that's correct for tsx/tsc at runtime, but Jest's resolver
// takes it literally. The moduleNameMapper below strips the extension
// so Jest re-resolves it against moduleFileExtensions (.ts first).
module.exports = {
  testEnvironment: "node",
  testMatch: ["**/*.test.ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  clearMocks: true,
};
