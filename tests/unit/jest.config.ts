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
    "../../third_party/idb-keyval.js": "<rootDir>/mock-idb.ts",
    "../../third_party/vfs.js": "<rootDir>/mock-vfs.ts",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
};

export default config;
