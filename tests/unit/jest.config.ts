import type { Config } from "@jest/types";

const config: Config.InitialOptions = {
  verbose: true,
  transform: {
    "^.+\\.[tj]s?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "<rootDir>/tsconfig.test.json",
        isolatedModules: true,
      },
    ],
  },
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "../../third_party/idb-keyval.js": "<rootDir>/mock-idb.ts",
    "^(\\.{1,2}/(?!.*third_party).*)\\.js$": "$1",
  },
};

export default config;
