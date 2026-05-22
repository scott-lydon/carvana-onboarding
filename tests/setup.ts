// Vitest setup file. Imported once before any test in vite.config.ts test config.
// jsdom is enabled there; fetch is provided by Node 20+ globally so no polyfill needed.
//
// Real per-test setup (e.g. mocking the EventReporter or VendorCascade) goes
// next to the consuming tests in slice 1+. Keeping this file thin until then.
export {};
