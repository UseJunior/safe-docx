import { createProviderLoader, type ProviderLoader, type ProviderLoadDiagnostic } from './provider_loader.js';

export type GDocsCoreModule = typeof import('@usejunior/google-docs-core');

export const gdocsCoreLoader: ProviderLoader<GDocsCoreModule> = createProviderLoader(
  () => import('@usejunior/google-docs-core'),
);

export async function loadGDocsCore(
  importer?: () => Promise<GDocsCoreModule>,
): Promise<GDocsCoreModule | null> {
  return gdocsCoreLoader.load(importer);
}

export function getGDocsCoreDiagnostic(): ProviderLoadDiagnostic<GDocsCoreModule> {
  return gdocsCoreLoader.getDiagnostic();
}

export function resetGDocsCoreLoaderForTesting(): void {
  gdocsCoreLoader.resetForTesting();
}
