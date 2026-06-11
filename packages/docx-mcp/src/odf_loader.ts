// Lazy loader for the @usejunior/odf-core provider, mirroring gdocs_loader.
// odf-core publishes with the main suite and is a regular dependency since #372, but
// always-loaded modules still reach ODF functionality through this loader (a dynamic
// import that returns null when odf-core is unavailable) so an install with a missing or
// broken odf-core degrades to structured ODF_UNAVAILABLE errors on the ODF tools instead
// of crashing the whole server at import time.
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
