#!/usr/bin/env tsx
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { hook_decision } from '#scripts/josh/hook-decision'
import { time_batch_guard } from './time/time-batch-guard'

// The disk half of the batching guard (joshuafolkken/kit#1390): find the transcript, read enough of
// its end, remember when a call was last refused, and write the refusal Claude Code understands.
//
// **It is a `PreToolUse` hook, and that is the point of the Issue.** The live density line rides
// `PostToolUse`, where the round trip has already been spent and all that is left is to describe it.
// Three runs measured after that line shipped came in at 1.10–1.12 calls per round trip, unchanged —
// so what is added here intervenes in the decision instead of reporting on it.
//
// **What the transcript holds is the turns already closed, and nothing usable about the one in hand.**
// Claude Code writes one line per content block and starts the first tool as soon as that block parses,
// so a turn's later `tool_use` lines do not exist yet — measured on a live session, they arrive 1.4 to
// 15 seconds afterwards. The decision is therefore made from closed history alone;
// `time-batch-guard.ts` → "What it cannot know" carries the measurement and what it costs.
//
// **The shell is `hook-decision.ts`, shared with the investigation guard** (joshuafolkken/kit#1460):
// the payload schema, the deny envelope, the switch, the `.env` load, the stamp that makes a refusal
// unrepeatable, and the six steps every refusing hook takes in the same order. What stays here is this
// guard's own rule and its own two names, and the seven exports below are unchanged so nothing that
// reads them had to move.

// The escape hatch. **On by default**, unlike `JOSH_EVAL`: this is a distributed convention rather
// than an opt-in measurement, and a guard nobody enables would leave the Issue exactly where it
// started. What the variable buys is a way to switch a refusing hook off without editing the settings
// file — a machine debugging the guard itself, or a session where a run of genuinely dependent single
// calls is expected.
const SWITCH_ENV_KEY = 'JOSH_BATCH_GUARD'

// **The judgement is `time-batch-guard.ts`'s, not a second one.** Whether a call is one this guard may
// refuse and whether the run has stopped batching are both its, so a refusal here can never disagree
// with the report the Issue's own verification step reads.
const GUARD = hook_decision.create_transcript_guard({
	prefix: 'josh-batch-guard-',
	switch_key: SWITCH_ENV_KEY,
	is_candidate: time_batch_guard.is_guarded_call,
	should_block: time_batch_guard.should_block,
	reason: time_batch_guard.REASON,
})

const batch_refusal = GUARD.refusal
const { is_enabled, refusal_path } = GUARD
const { deny_envelope, load_environment_file, DISABLED_VALUES } = hook_decision

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (process.stdin.isTTY) hook_decision.report_no_payload('batch:guard')
	else hook_decision.write_decision(await text(process.stdin), batch_refusal)
}

export {
	batch_refusal,
	deny_envelope,
	is_enabled,
	load_environment_file,
	refusal_path,
	DISABLED_VALUES,
	SWITCH_ENV_KEY,
}
