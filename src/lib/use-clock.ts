"use client";

import { useSyncExternalStore } from "react";

/**
 * Shared ticking clock. Returns null during server rendering and hydration so
 * time-derived values match on both sides. One interval serves all subscribers.
 */
const listeners = new Set<() => void>();
let current = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (!timer) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      for (const listener of listeners) listener();
    }, 5_000);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot() {
  if (current === 0) current = Date.now();
  return current;
}

export function useClock(): Date | null {
  const ms = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => null,
  );
  return ms === null ? null : new Date(ms);
}

/** Force an immediate tick, e.g. after the user's own action changes state. */
export function tickNow() {
  current = Date.now();
  for (const listener of listeners) listener();
}
