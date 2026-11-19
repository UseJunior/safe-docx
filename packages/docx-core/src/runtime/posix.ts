/** POSIX package-part paths, independent of host filesystem or working directory. */
function normalize(path: string): string {
  const absolute = path.startsWith('/');
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..' && parts.length && parts.at(-1) !== '..') parts.pop();
    else if (part !== '..' || !absolute) parts.push(part);
  }
  let result = (absolute ? '/' : '') + parts.join('/');
  if (!result) result = '.';
  if (path.endsWith('/') && result !== '/') result += '/';
  return result;
}
function dirname(path: string): string {
  if (!path) return '.';
  let end = path.length - 1;
  while (end > 0 && path[end] === '/') end--;
  const slash = path.lastIndexOf('/', end);
  if (slash < 0) return '.';
  if (slash === 0) return '/';
  if (slash === 1 && path.startsWith('/')) return '//';
  return path.slice(0, slash);
}
function basename(path: string): string {
  let end = path.length;
  while (end > 0 && path[end - 1] === '/') end--;
  if (end === 0) return '';
  return path.slice(path.lastIndexOf('/', end - 1) + 1, end);
}
function extname(path: string): string {
  const base = basename(path), dot = base.lastIndexOf('.');
  return dot <= 0 || base === '..' ? '' : base.slice(dot);
}
function join(...paths: string[]): string {
  return normalize(paths.filter(Boolean).join('/'));
}
function relative(from: string, to: string): string {
  // Package paths are relative to the same virtual root, never process.cwd().
  const parts = (path: string): string[] => normalize('/' + path).split('/').filter(Boolean);
  const a = parts(from), b = parts(to);
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared++;
  return [...a.slice(shared).map(() => '..'), ...b.slice(shared)].join('/');
}
/** @internal Package-part path operations; not a host filesystem API. */
export const posix = { normalize, dirname, basename, extname, join, relative };
