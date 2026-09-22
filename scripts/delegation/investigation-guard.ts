#!/usr/bin/env tsx
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { hook_decision, type GuardRun } from '#scripts/josh/hook-decision'
import { lane_guard_policy, type LaneGuardMode } from '#scripts/lane/lane-guard-policy'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
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

// This guard's refusal record, and the notice's own record — distinct so a lane-child notice never
// spends the refusal's stamp (joshuafolkken/kit#2382), the same split the batching guard keeps.
const STAMP_PREFIX = 'josh-investigation-guard-'
const NOTICE_STAMP_PREFIX = 'josh-investigation-guard-notice-'

// **How the guard behaves for the session in hand, decided from the one-place enumeration**
// (joshuafolkken/kit#2138, joshuafolkken/kit#2382). Outside a lane child the mode is `refuse` and the
// guard is exactly what it always was; in a dispatched lane child it is `notice` since kit#2382 — it was
// `off` from #2138, on the reason that a child cannot dispatch a sub-unit to read its own edit targets,
// but #2382 measured six lane children reading 4–17 unedited files each and dispatching sub-agents, so
// the reading was there to send out. The enumeration reads `JOSH_LANE_CHILD` against this checkout's own
// issue only for a guard whose mode it would change, so a person working in a lane sees the guard
// unchanged. It wraps `investigation_reads.should_block` here rather than inside it so the pure counting
// rule stays free of process state and its own suite keeps testing it directly.
function investigation_mode(): LaneGuardMode {
	return lane_guard_policy.mode_here('investigation')
}

// A refusable call is refused only where the mode is `refuse` — the main line. A lane child is `notice`
// (kit#2382), so it reaches the notice branch and is withheld the refusal that would end its headless
// turn (kit#2138); an `off` some future enumeration sets stays silent here too.
function should_block(
	tail: string,
	call: GuardedCall,
	refused_at_ms: number,
	run?: GuardRun,
): boolean {
	if (investigation_mode() !== 'refuse') return false

	return investigation_reads.should_block(tail, call, refused_at_ms, run)
}

// The lane-child notice: the same threshold, delivered without a `permissionDecision` (kit#2382). It
// reads the notify stamp's own record, so a notice never spends the refusal's stamp and re-arms on the
// next accumulation exactly as the refusal does.
function should_notify(
	tail: string,
	call: GuardedCall,
	notified_at_ms: number,
	run?: GuardRun,
): boolean {
	if (investigation_mode() !== 'notice') return false

	return investigation_reads.should_block(tail, call, notified_at_ms, run)
}

// **The lane-child counterpart of REASON, delivered as a notice rather than a refusal**
// (joshuafolkken/kit#2138, joshuafolkken/kit#2382). A dispatched lane child ends its turn on a denial, so
// the same guidance is carried without a `permissionDecision`: the read proceeds and the child is nudged
// to delegate rather than killed. It carries no ⛔, so a person watching reads it as advice.
const NOTICE = `💡 investigation: files read and not edited since the last delegated unit reached the threshold, so the reading from here should go to a unit of its own. This is a notice, not a refusal — the read proceeds, because a dispatched lane child ends its turn on a denial. Ask \`pnpm josh delegate investigation\`, then brief a unit with what the main line has already concluded and what is left to find out; it returns the conclusion plus its \`file:line\` citations, never the file text. Keep a read in the main line only where this run will edit that file. This recurs on the next accumulation.`

// The notice as it reaches the model: the base guidance with the concrete unedited reads named (kit#2276,
// kit#2382), so a lane child is shown *which* reads to send to a unit rather than only told to delegate —
// the #2276 precedent against the generic notice #2164 → #2178 measured not to move the number. An empty
// set names nothing and the notice falls back to its guidance alone. The call is part of the notify
// contract but this guard's wording depends on the tail alone.
function notice_text(_call: GuardedCall, tail: string): string {
	const pending = investigation_reads
		.tally_of(tail)
		.pending.map((absolute) => investigation_reads.repository_relative(absolute))

	return pending.length === 0
		? NOTICE
		: `${NOTICE} Read and not edited so far: ${pending.join(' ')}.`
}

const GUARD = hook_decision.create_transcript_guard({
	prefix: STAMP_PREFIX,
	switch_key: SWITCH_ENV_KEY,
	is_candidate: investigation_reads.is_refusable_call,
	should_block,
	reason: investigation_reads.REASON,
	// The lane-child notice fires where the refusal is withheld (kit#2382), on a record of its own so it
	// never spends the refusal's stamp.
	notify: {
		prefix: NOTICE_STAMP_PREFIX,
		should_notify,
		text: notice_text,
	},
})

const investigation_refusal = GUARD.refusal
const investigation_outcome = GUARD.outcome
const { is_enabled, refusal_path } = GUARD
// The notice's stamp path, exposed the way `refusal_path` is so a test can clean it apart from the
// refusal's record (joshuafolkken/kit#2382).
const investigation_notice_path = hook_decision.create_refusal_stamp(NOTICE_STAMP_PREFIX).path
const { deny_envelope, load_environment_file, DISABLED_VALUES } = hook_decision

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (process.stdin.isTTY) hook_decision.report_no_payload('investigation:guard')
	else hook_decision.write_outcome(await text(process.stdin), investigation_outcome)
}

export {
	deny_envelope,
	investigation_notice_path,
	investigation_outcome,
	investigation_refusal,
	is_enabled,
	load_environment_file,
	refusal_path,
	DISABLED_VALUES,
	NOTICE,
	SWITCH_ENV_KEY,
}
