#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { security_audit_cache } from './security-audit-cache'

// The `josh audit` entry, kept apart from `security-audit.ts` because `start-steps.ts` imports that
// one: a bundle is one file, so a main guard there would fire for every command that carries it
// (joshuafolkken/kit#4186). The audit takes no arguments.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await security_audit_cache.run()
}
