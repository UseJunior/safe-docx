import { type AllureRuntime as SharedAllureRuntime, type AllureStepContext as SharedAllureStepContext } from '../../../../testing/allure-test-factory.js';
type EpicName = 'DOCX Primitives' | 'OpenSpec Traceability';
export type AllureRuntime = SharedAllureRuntime;
export type AllureStepContext = SharedAllureStepContext;
export declare const itAllure: import("../../../../testing/allure-test-factory.js").WrappedAllureTestFn<EpicName>, testAllure: import("../../../../testing/allure-test-factory.js").WrappedAllureTestFn<EpicName>, allureStep: <T>(name: string, run: () => T | Promise<T>) => Promise<T>, allureParameter: (name: string, value: string) => Promise<void>, allureAttachment: (name: string, content: string, contentType?: string) => Promise<void>, allureJsonAttachment: (name: string, payload: unknown) => Promise<void>, getAllureRuntime: () => SharedAllureRuntime | undefined;
export {};
//# sourceMappingURL=allure-test.d.ts.map