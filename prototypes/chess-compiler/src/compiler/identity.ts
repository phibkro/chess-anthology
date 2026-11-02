import { createHash } from "node:crypto";
export function digest(text: string) {
  return createHash("sha256").update(text).digest("hex");
}
export function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
