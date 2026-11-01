#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { session_owner_pin } from '#scripts/discovery/session-owner-pin'
import { session_model_record } from '#scripts/josh/session-model-record'
import { security_audit_provision } from './security-audit-provision'

// The `josh audit:provision` entry and the session-start hook's bundle, kept apart from
// `security-audit-provision.ts` because `start-steps.ts` imports that one: a bundle is one file, so a
// main guard there would fire for every command that carries it (joshuafolkken/kit#4186).
//
// Run by the session-start hook (`--session-start`), it also pins the session's owner
// (`session-owner-pin.ts`) and records the payload's model (`session-model-record.ts`) at no spawn of
// its own. A manual `josh audit:provision` pins only when
// passed `--session-start`, which re-pins to whatever owner `origin` names at that moment.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2
	const SESSION_START_FLAG = '--session-start'
	const argv = process.argv.slice(ARGV_OFFSET)

	if (argv.includes(SESSION_START_FLAG)) {
		session_owner_pin.pin()
		await session_model_record.record_from_stdin()
	}

	await security_audit_provision.run(argv)
}
