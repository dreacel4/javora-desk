import "server-only";

/** Wall-clock time of the current request, used to seed client countdowns. */
export function requestTime(): number {
  return Date.now();
}
