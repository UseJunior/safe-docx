/** Node-only oracles and opt-in filesystem schema capture. */
import './runtime/node-capture.js';
export * from './index.js';
export { resolveSoffice, probeSofficeUsable, runLibreOfficeOracle, type OracleJob } from './integration/libreoffice-oracle.js';
