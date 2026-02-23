import { type AllureBddContext as SharedAllureBddContext, type AllureRuntime as SharedAllureRuntime, type AllureStepContext as SharedAllureStepContext } from '../../../../testing/allure-test-factory.js';
export type AllureRuntime = SharedAllureRuntime;
export type AllureStepContext = SharedAllureStepContext;
export type AllureBddContext = SharedAllureBddContext;
export declare const itAllure: import("@usejunior/allure-test-factory").WrappedAllureTestFn<"DOCX Primitives">, testAllure: import("@usejunior/allure-test-factory").WrappedAllureTestFn<"DOCX Primitives">, allureStep: <T>(name: string, run: () => T | Promise<T>) => Promise<T>, allureParameter: (name: string, value: string) => Promise<void>, allureAttachment: (name: string, content: string | Uint8Array, contentType?: string) => Promise<void>, allureJsonAttachment: (name: string, payload: unknown) => Promise<void>, getAllureRuntime: () => SharedAllureRuntime | undefined;
//# sourceMappingURL=allure-test.d.ts.map