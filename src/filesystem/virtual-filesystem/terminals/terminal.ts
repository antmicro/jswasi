import { DeviceDriver } from "../driver-manager.js";
import { UserData, EventType, PollEvent } from "../../../types.js";

// Ioctl magic numbers for terminal devices
export const enum ioctlRequests {
  GET_SCREEN_SIZE = 0,
  SET_RAW = 1,
  SET_ECHO = 2,
}

// Buffer request is enqueued each read call, once data is available,
// calling resolve resolves promise returned by the read call
export type BufferRequest = {
  len: number;
  pid: number;
  resolve: (ret: { err: number; buffer: ArrayBuffer }) => void;
};

// Interface for interacting with terminals mainatained by terminal
// device driver. One Terminal implementator instance is assigned to
// one minor number
export interface Terminal {
  echo: boolean;
  raw: boolean;
  foregroundPid: number | null;
  bufRequestQueue: BufferRequest[];

  getScreenSize(): Promise<[number, number]>;
}

// Extended device driver interface for interacting with terminal
// device drivers
export interface TerminalDriver extends DeviceDriver {
  terminals: Record<number, Terminal>;

  promiseSignal(
    userdata: UserData,
    workerId: number,
    eventType: EventType,
    min: number
  ): Promise<PollEvent>;
}
