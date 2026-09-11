"use client";

const KEY = "kada.vendor";

export interface VendorSession {
  token: string;
  shopId: string;
  slug: string;
}

const listeners = new Set<() => void>();
let cache: string | null | undefined;

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** Raw string keeps the snapshot referentially stable across renders. */
function getSnapshot(): string | null {
  if (cache === undefined) {
    try {
      cache = window.localStorage.getItem(KEY);
    } catch {
      cache = null;
    }
  }
  return cache;
}

/** `undefined` on the server means "not known yet", distinct from "signed out". */
function getServerSnapshot(): undefined {
  return undefined;
}

export const vendorStore = { subscribe, getSnapshot, getServerSnapshot };

export function saveVendorSession(value: VendorSession | null) {
  try {
    if (value) window.localStorage.setItem(KEY, JSON.stringify(value));
    else window.localStorage.removeItem(KEY);
  } catch {
    // A refused storage API still allows the session to work for this visit.
  }
  cache = value ? JSON.stringify(value) : null;
  for (const listener of listeners) listener();
}

export function parseVendorSession(raw: string | null | undefined): VendorSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as VendorSession;
    return parsed?.token && parsed?.shopId ? parsed : null;
  } catch {
    return null;
  }
}
