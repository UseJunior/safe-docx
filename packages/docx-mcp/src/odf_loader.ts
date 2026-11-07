// Lazy loader for the @usejunior/odf-core provider, mirroring gdocs_loader.
// odf-core publishes with the main suite and is a regular dependency since #372, but
// always-loaded modules still reach ODF functionality through this loader (a dynamic
// import that returns null when odf-core is unavailable) so an install with a missing or
// broken odf-core degrades to structured ODF_UNAVAILABLE errors on the ODF tools instead
// of crashing the whole server at import time.

import { createProviderLoader, type ProviderLoader, type ProviderLoadDiagnostic } from './provider_loader.js';

export type OdfCoreModule = typeof import('@usejunior/odf-core');

export const odfCoreLoader: ProviderLoader<OdfCoreModule> = createProviderLoader(
  () => import('@usejunior/odf-core'),
);

export async function loadOdfCore(
  importer?: () => Promise<OdfCoreModule>,
): Promise<OdfCoreModule | null> {
  return odfCoreLoader.load(importer);
}

export function getOdfCoreDiagnostic(): ProviderLoadDiagnostic<OdfCoreModule> {
  return odfCoreLoader.getDiagnostic();
}

export function resetOdfCoreLoaderForTesting(): void {
  odfCoreLoader.resetForTesting();
}
