/* oxlint-disable anti-slop/no-unknown-parameters -- Assertions compare arbitrary external values; they are not parsers that can require a domain model. */
interface Assertions {
  deepEqual: (actual: unknown, expected: unknown, message?: string) => void;
  equal: (actual: unknown, expected: unknown, message?: string) => void;
  fail: (message?: string) => never;
  notEqual: (actual: unknown, expected: unknown, message?: string) => void;
  ok: (condition: unknown, message?: string) => asserts condition;
}
/* oxlint-enable anti-slop/no-unknown-parameters */

/** Bun-native evaluation assertions, usable both inside and outside a test runner. */
export const assert: Assertions = {
  deepEqual: (actual, expected, message) => {
    if (!Bun.deepEquals(actual, expected, true)) {
      throw new Error(
        message ??
          `Expected strict deep equality: ${Bun.inspect(actual)} versus ${Bun.inspect(expected)}`
      );
    }
  },
  equal: (actual, expected, message) => {
    if (!Object.is(actual, expected)) {
      throw new Error(
        message ??
          `Expected equality: ${Bun.inspect(actual)} versus ${Bun.inspect(expected)}`
      );
    }
  },
  fail: (message) => {
    throw new Error(message ?? "Assertion failed.");
  },
  notEqual: (actual, expected, message) => {
    if (Object.is(actual, expected)) {
      throw new Error(message ?? "Expected distinct values.");
    }
  },
  ok: (condition, message) => {
    const successful = Boolean(condition);
    if (!successful) {
      throw new Error(message ?? "Expected a truthy value.");
    }
  },
};
