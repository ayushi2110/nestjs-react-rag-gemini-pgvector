module.exports = {
  rootDir: ".",
  testEnvironment: "node",
  testRegex: "/test/.*\\.spec\\.ts$",
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.json" }],
  },
  moduleFileExtensions: ["ts", "js", "json"],
  clearMocks: true,
};
