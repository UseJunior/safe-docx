// Lazy loader for the @usejunior/odf-core provider, mirroring gdocs_loader.
// odf-core publishes with the main suite and is a regular dependency since #372, but
// always-loaded modules still reach ODF functionality through this loader (a dynamic
// import that returns null when odf-core is unavailable) so an install with a missing or
// broken odf-core degrades to structured ODF_UNAVAILABLE errors on the ODF tools instead
// of crashing the whole server at import time.
import { ProviderLoader } from './provider_loader.js';

export const odfProviderLoader = new ProviderLoader(() => import('@usejunior/odf-core'));

export function loadOdfCore(): Promise<typeof import('@usejunior/odf-core') | null> {
  return odfProviderLoader.load();
}
