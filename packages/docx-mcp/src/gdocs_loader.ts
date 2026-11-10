import { ProviderLoader } from './provider_loader.js';

export const gdocsProviderLoader = new ProviderLoader(() => import('@usejunior/google-docs-core'));

export function loadGDocsCore(): Promise<typeof import('@usejunior/google-docs-core') | null> {
  return gdocsProviderLoader.load();
}
