#!/usr/bin/env tsx
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { hook_decision } from '#scripts/josh/hook-decision'
import { investigation_reads } from './investigation-reads'

// The disk half of the investigation-delegation threshold (joshuafolkken/kit#1460): find the
// transcript, read enough of its end, count the files read and not edited since the last delegated
// unit, and refuse the read that takes that count up to the threshold.
//
// **It is a `PreToolUse` hook because the rule it enforces has already failed as prose.**
// joshuafolkken/kit#1426 wrote the count into two documents and into the enumeration; run #1441 then
// asked the question once and read 8 more unedited files without asking again. The counting is
// `investigation-reads.ts`, and the shell — the six steps every refusing hook takes, every one of
// which allows the call when it fails — is `hook-decision.ts`, shared with `batch-guard.ts`.

// The escape hatch, **on by default** for the reason `JOSH_BATCH_GUARD` is: this is a distributed
// convention rather than an opt-in measurement, and a guard nobody enables leaves the Issue where it
// started. What the variable buys is a way to switch a refusing hook off without editing the settings
// file — debugging the guard itself, or a session whose reading really is all edit targets.
const SWITCH_ENV_KEY = 'JOSH_INVESTIGATION_GUARD'

const GUARD = hook_decision.create_transcript_guard({
	prefix: 'josh-investigation-guard-',
	switch_key: SWITCH_ENV_KEY,
	is_candidate: investigation_reads.is_refusable_call,
	should_block: investigation_reads.should_block,
	reason: investigation_reads.REASON,
})

const investigation_refusal = GUARD.refusal
const { is_enabled, refusal_path } = GUARD
const { deny_envelope, load_environment_file, DISABLED_VALUES } = hook_decision

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (process.stdin.isTTY) hook_decision.report_no_payload('investigation:guard')
	else hook_decision.write_decision(await text(process.stdin), investigation_refusal)
}

export {
	deny_envelope,
	investigation_refusal,
	is_enabled,
	load_environment_file,
	refusal_path,
	DISABLED_VALUES,
	SWITCH_ENV_KEY,
}
