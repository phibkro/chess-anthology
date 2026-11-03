/** A local semantic issue addressed by a structured path. */
export interface Issue {
  code: string;
  message: string;
  path: (string | number)[];
}
/** A recursively read-only view of a plain contract value. */
export type ReadonlyDeep<T> = T extends object
  ? { readonly [K in keyof T]: ReadonlyDeep<T[K]> }
  : T;
/** An expected boundary failure or caught infrastructure failure. */
export interface Failure {
  kind:
    | "syntax"
    | "schema"
    | "io"
    | "chess"
    | "integrity"
    | "selection"
    | "infrastructure";
  code: string;
  message: string;
  paths?: readonly string[];
}
/** A success value or an explicitly handled failure. */
export type Result<T, E = Failure> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
/**
 * Wrap a successful boundary value.
 * @param value - The completed result.
 * @returns A success discriminant and its value.
 */
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
/**
 * Create a failure value without throwing.
 * @param kind - The failure category.
 * @param code - A stable machine-readable identifier.
 * @param message - An actionable explanation.
 * @returns A failure discriminant and its diagnostic.
 */
export const err = (
  kind: Failure["kind"],
  code: string,
  message: string
): Result<never> => ({
  error: { code, kind, message },
  ok: false,
});
