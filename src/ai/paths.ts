export const PROTECTED = [
  /^src\/engineering\//,
  /^src\/equipment\//,
  /^src\/project\/schema/,
  /^src\/project\/factory/,
];

export const WRITABLE = [/^src\/components\//, /^src\/styles\.css$/, /^src\/ai\/registry\.ts$/, /^src\/ai\/intent\.ts$/];

export function isProtectedPath(rel: string): boolean {
  const n = rel.replace(/\\/g, "/");
  return PROTECTED.some((r) => r.test(n));
}

export function isWritablePath(rel: string): boolean {
  const n = rel.replace(/\\/g, "/");
  if (isProtectedPath(n)) return false;
  if (n.includes("..")) return false;
  return WRITABLE.some((r) => r.test(n));
}
