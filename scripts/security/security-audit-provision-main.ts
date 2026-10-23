#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { session_owner_pin } from '#scripts/discovery/session-owner-pin'
import { security_audit_provision } from './security-audit-provision'

// The `josh audit:provision` entry and the session-start hook's bundle, kept apart from
// `security-audit-provision.ts` because `start-steps.ts` imports that one: a bundle is one file, so a
// main guard there would fire for every command that carries it (joshuafolkken/kit#4186).
//
// Run by the session-start hook (`--session-start`), it also pins the session's owner
// (`session-owner-pin.ts`) at no spawn of its own. A manual `josh audit:provision` does not pin, so it
// cannot re-pin an owner after a mid-session `origin` rewrite.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2
	const SESSION_START_FLAG = '--session-start'
	const argv = process.argv.slice(ARGV_OFFSET)

	if (argv.includes(SESSION_START_FLAG)) session_owner_pin.pin()
	await security_audit_provision.run(argv)
}
