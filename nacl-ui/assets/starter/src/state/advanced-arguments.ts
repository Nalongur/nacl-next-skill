export function validAdvancedArguments(value: unknown): value is string {
  return typeof value === "string" && new TextEncoder().encode(value).length <= 4096 && !/\p{Cc}/u.test(value);
}
