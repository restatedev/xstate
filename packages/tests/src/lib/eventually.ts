import { expect } from "vitest";

export function eventually<T>(fn: () => T): ReturnType<typeof expect.poll<T>> {
  return expect.poll<T>(fn, {
    timeout: 30000,
    interval: 250,
  });
}

export const wait = (ms = 0): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};
