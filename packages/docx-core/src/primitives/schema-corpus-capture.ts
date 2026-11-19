/** Optional synchronous sink installed by the /node entry; portable imports perform no I/O. */
let capture: ((xml: string) => void) | undefined;
export function setEmittedDocumentXmlCapture(sink: ((xml: string) => void) | undefined): void {
  capture = sink;
}
export function maybeCaptureEmittedDocumentXml(xml: string): void {
  capture?.(xml);
}
