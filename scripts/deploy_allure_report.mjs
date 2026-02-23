#!/usr/bin/env node

/**
 * Allure report deployment information.
 *
 * Production deployments are handled automatically by CI via GitHub Pages.
 * See .github/workflows/ci.yml → deploy-allure job.
 *
 * The workflow uses OIDC (id-token: write) — no static secrets needed.
 * Push to main → CI deploys to https://tests.safedocx.com
 *
 * To preview the report locally:
 *   npm run allure:generate && npm run allure:brand
 *   npm run allure:open
 */

console.log("Allure report deployment is handled by CI via GitHub Pages.");
console.log("");
console.log("Push to main → CI auto-deploys to https://tests.safedocx.com");
console.log("");
console.log("To preview locally:");
console.log("  npm run allure:generate && npm run allure:brand");
console.log("  npm run allure:open");
