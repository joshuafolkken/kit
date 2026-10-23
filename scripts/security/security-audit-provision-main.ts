#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { security_audit_provision } from './security-audit-provision'

// The `josh audit:provision` entry and the session-start hook's bundle, kept apart from
// `security-audit-provision.ts` because `start-steps.ts` imports that one: a bundle is one file, so a
// main guard there would fire for every command that carries it (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	await security_audit_provision.run(process.argv.slice(ARGV_OFFSET))
}
