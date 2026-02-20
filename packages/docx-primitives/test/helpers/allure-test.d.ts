import { it as vitestIt } from 'vitest';
type WrappedTestFn = typeof vitestIt;
type EpicName = 'DOCX Primitives' | 'OpenSpec Traceability';
interface AllureLabelDefaults {
    epic?: EpicName;
    feature?: string;
    parentSuite?: string;
    suite?: string;
    subSuite?: string;
    openspecScenarioIds?: string[];
}
type WrappedAllureTestFn = WrappedTestFn & {
    withLabels: (defaults: AllureLabelDefaults) => WrappedAllureTestFn;
    epic: (epic: EpicName) => WrappedAllureTestFn;
    openspec: (...scenarioIds: Array<string | string[]>) => WrappedAllureTestFn;
};
export declare const itAllure: WrappedAllureTestFn;
export declare const testAllure: WrappedAllureTestFn;
export declare function allureStep<T>(name: string, run: () => T | Promise<T>): Promise<T>;
export declare function allureParameter(name: string, value: string): Promise<void>;
export declare function allureAttachment(name: string, content: string, contentType?: string): Promise<void>;
export declare function allureJsonAttachment(name: string, payload: unknown): Promise<void>;
export {};
//# sourceMappingURL=allure-test.d.ts.map
