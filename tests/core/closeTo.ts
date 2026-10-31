import { expect } from "vitest";

/**
 * Absolute check (default 1e-6) that also checks the relative error when the
 * reference is smaller than the tolerance, so a tail p-value of 0 cannot pass
 * against a reference like 3e-9.
 */
export function expectCloseTail(actual: number, reference: number, tol = 1e-6): void {
  expect(Math.abs(actual - reference)).toBeLessThan(tol);
  if (reference !== 0 && Math.abs(reference) < tol) {
    expect(Math.abs(actual - reference) / Math.abs(reference)).toBeLessThan(1e-6);
  }
}
