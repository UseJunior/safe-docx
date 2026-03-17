let cached: typeof import('@usejunior/google-docs-core') | null | undefined;

export async function loadGDocsCore(): Promise<typeof import('@usejunior/google-docs-core') | null> {
  if (cached !== undefined) return cached;
  try {
    cached = await import('@usejunior/google-docs-core');
    return cached;
  } catch {
    cached = null;
    return null;
  }
}
