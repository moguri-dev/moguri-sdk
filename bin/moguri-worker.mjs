#!/usr/bin/env node
// Runs the versioned Moguri SSH worker bridge on stdio, as `moguri worker --stdio` does.
await import("../dist/remote-bridge.mjs");
