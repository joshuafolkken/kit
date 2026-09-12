#!/usr/bin/env tsx
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { hook_decision } from '#scripts/josh/hook-decision'
import { time_batch_guard, type GuardedCall } from './time/time-batch-guard'

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
// The transcript is read for a call the guard could act on either way: one it may refuse, or the one
// whole-file write it may only notify about (joshuafolkken/kit#1848). The read is skipped for the rest
// exactly as before — most of a run's calls are neither.
function is_batch_candidate(call: GuardedCall): boolean {
	return time_batch_guard.is_guarded_call(call) || time_batch_guard.is_notice_call(call)
}

const GUARD = hook_decision.create_transcript_guard({
	prefix: time_batch_guard.STAMP_PREFIX,
	switch_key: SWITCH_ENV_KEY,
	is_candidate: is_batch_candidate,
	should_block: time_batch_guard.should_block,
	reason: time_batch_guard.REASON,
	// The whole-file write is notified rather than refused, on a record of its own so it never spends
	// the refusal's stamp (joshuafolkken/kit#1848).
	notify: {
		prefix: time_batch_guard.NOTICE_STAMP_PREFIX,
		should_notify: time_batch_guard.should_notify,
		text: time_batch_guard.NOTICE,
	},
})

const batch_refusal = GUARD.refusal
const batch_outcome = GUARD.outcome
const { is_enabled, refusal_path } = GUARD
// The notice's stamp path, exposed the way `refusal_path` is so a test can clean it apart from the
// refusal's record (joshuafolkken/kit#1848).
const notice_refusal_path = hook_decision.create_refusal_stamp(
	time_batch_guard.NOTICE_STAMP_PREFIX,
).path
const { deny_envelope, load_environment_file, DISABLED_VALUES } = hook_decision

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (process.stdin.isTTY) hook_decision.report_no_payload('batch:guard')
	else hook_decision.write_outcome(await text(process.stdin), batch_outcome)
}

export {
	batch_outcome,
	batch_refusal,
	deny_envelope,
	is_enabled,
	load_environment_file,
	notice_refusal_path,
	refusal_path,
	DISABLED_VALUES,
	SWITCH_ENV_KEY,
}
