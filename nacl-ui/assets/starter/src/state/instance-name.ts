// Rust str::trim uses Unicode White_Space; Array.from counts code points.
export function normalizedInstanceName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
  return name && Array.from(name).length <= 64 && !/[\p{Cc}\p{Cs}]/u.test(name) ? name : null;
}
