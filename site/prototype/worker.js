import { compareDocuments } from '@usejunior/docx-compare';

self.onmessage = async ({ data: [original, revised] }) => {
  try {
    const { document, unrepresentedChanges } = await compareDocuments(
      new Uint8Array(await original.arrayBuffer()),
      new Uint8Array(await revised.arrayBuffer()),
      { author: 'Safe DOCX', date: null, revisionFidelity: true },
    );
    // Some comparisons can describe differences that Word cannot express as revisions.
    self.postMessage(unrepresentedChanges?.length ? { fidelityViolation: true } : { document });
  } catch (error) {
    self.postMessage({ fidelityViolation: error?.code === 'REVISION_FIDELITY_VIOLATION' });
  }
};
