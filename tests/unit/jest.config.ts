import type { Config } from "@jest/types";

const config: Config.InitialOptions = {
  verbose: true,
  transform: {
    "^.+\\.ts?$": [
      "ts-jest",
      {
        useESM: true,
      },
    ],
  },
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "../../vendor/idb-keyval.js": "<rootDir>/mock-idb.ts",
    "../../vendor/vfs.js": "<rootDir>/mock-vfs.ts",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
};

export default config;
