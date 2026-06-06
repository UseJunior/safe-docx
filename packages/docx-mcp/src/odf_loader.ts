// Lazy loader for the OPTIONAL @usejunior/odf-core provider, mirroring gdocs_loader.
// odf-core is private/unpublished, so it is NOT a package.json dependency and may be
// absent from a production install of the published package. Always-loaded modules
// must reach ODF functionality through this loader (a dynamic import that returns
// null when odf-core is unavailable) rather than a static import.
let cached: typeof import('@usejunior/odf-core') | null | undefined;

export async function loadOdfCore(): Promise<typeof import('@usejunior/odf-core') | null> {
  if (cached !== undefined) return cached;
  try {
    cached = await import('@usejunior/odf-core');
    return cached;
  } catch {
    cached = null;
    return null;
  }
}
