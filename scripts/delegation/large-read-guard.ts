import { statSync } from 'node:fs'
import type { HookContext } from '#scripts/hooks/hook-context'
import { hook_decision, type GuardRun } from '#scripts/josh/hook-decision'
import { lane_guard_policy, type LaneGuardMode } from '#scripts/lane/lane-guard-policy'
import { json_value } from '#scripts/lib/json-value'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { time_spans, type Span } from '#scripts/time-runtime/time-spans'
import { duplicate_reads } from './duplicate-read-guard'
import { investigation_reads } from './investigation-reads'

// Refuse a whole-file `Read` of a large file (joshuafolkken/kit#7047). The result stays in context and
// is cache-read on every later call, so one large read is paid again on each turn after it; a `Grep`
// for the part needed and an `offset` / `limit` read of it carry a fraction of that.
//
// **A repeat of the refused call goes through.** It is keyed on the file, not on the last firing: a
// whole read passes when the latest `Read` of the same file in the transcript was refused — by this
// guard or by the duplicate-read guard, so one repeat clears both — whatever was read in between.
//
// **It speaks as the duplicate-read guard does** — the same lane enumeration row, for the same reason:
// a refusal ends a headless lane child's turn, so there it is a notice and the read proceeds.
const SWITCH_ENV_KEY = 'JOSH_LARGE_READ_GUARD'
const LANE_GUARD_ID = 'duplicate-read'
const STAMP_PREFIX = 'josh-large-read-guard-'
const NOTICE_STAMP_PREFIX = 'josh-large-read-notice-'
const READ_TOOL = 'Read'
const BYTES_PER_KB = 1024
const LARGE_READ_KB = 32
const LARGE_READ_BYTES = LARGE_READ_KB * BYTES_PER_KB
const LIMIT_TEXT = `${String(LARGE_READ_KB)} KB`

const REASON = `⛔ large read: this file is over ${LIMIT_TEXT}, and a whole-file read stays in context and is re-billed on every later call. Grep for the part you need and Read it with offset/limit. Repeat the same call to read the whole file anyway; set \`JOSH_LARGE_READ_GUARD=off\` to disable this guard.`

const NOTICE = `⚠ large read: this file is over ${LIMIT_TEXT} — next time Grep for the part you need and Read it with offset/limit. Set \`JOSH_LARGE_READ_GUARD=off\` to silence this.`

// A `Read` with no `offset` and no `limit`, the only call that returns the whole file.
function is_whole_read(
	call: GuardedCall,
): call is GuardedCall & { input: Record<string, unknown> } {
	if (call.name !== READ_TOOL || !json_value.is_record(call.input)) return false

	return call.input['offset'] === undefined && call.input['limit'] === undefined
}

// **A stat that fails allows the call** — a missing file or a glob names nothing to measure.
function file_bytes(target: string): number {
	try {
		return statSync(target).size
	} catch {
		return 0
	}
}

// The absolute path of a whole-file `Read`, or `undefined` for any other call.
function whole_read_target(call: GuardedCall, root: string): string | undefined {
	if (!is_whole_read(call)) return undefined

	const { file_path } = call.input

	if (typeof file_path !== 'string' || file_path === '') return undefined

	return investigation_reads.resolved(file_path, root)
}

function is_large_read(call: GuardedCall, root: string): boolean {
	const target = whole_read_target(call, root)

	return target !== undefined && file_bytes(target) > LARGE_READ_BYTES
}

function large_read_mode(context: HookContext): LaneGuardMode {
	return lane_guard_policy.mode_here(LANE_GUARD_ID, context.cwd, context.env)
}

function is_candidate(call: GuardedCall, context: HookContext): boolean {
	return is_large_read(call, context.cwd) && large_read_mode(context) !== 'off'
}

// When the run's last successful `Read` landed, or `NEVER_MS` where the tail holds none.
function last_read_ms(spans: ReadonlyArray<Span>): number {
	const times = spans
		.filter((span) => duplicate_reads.is_successful_read(span))
		.map((span) => span.ended_ms)

	return times.length === 0 ? hook_decision.NEVER_MS : Math.max(...times)
}

// **The notice re-arms once a `Read` lands after it**, or once it leaves the window — the notice does
// not stop the read, so one notice per landed read is all it needs to say.
function is_rearmed(tail: string, fired_at_ms: number): boolean {
	const { spans, started_ms } = time_spans.parse_timeline(tail)

	if (fired_at_ms === hook_decision.NEVER_MS || fired_at_ms < started_ms) return true

	return last_read_ms(spans) > fired_at_ms
}

function is_read_of(span: Span, target: string, root: string): boolean {
	const is_read = span.label === READ_TOOL

	return is_read && span.targets.some((one) => investigation_reads.resolved(one, root) === target)
}

// **The repeat of a refused read**: the latest `Read` of this file in the window failed — refused by a
// guard, or rejected by the tool — so the run has not got the text and is asking again.
function is_repeat_of_refusal(tail: string, target: string, root: string): boolean {
	const reads = time_spans
		.parse_timeline(tail)
		.spans.filter((span) => is_read_of(span, target, root))
	const latest = reads.at(-1)

	return latest?.outcome === time_spans.FAILED_OUTCOME
}

function refuses(tail: string, call: GuardedCall, _fired_at_ms: number, run: GuardRun): boolean {
	const { cwd } = run.context
	const target = whole_read_target(call, cwd)

	if (target === undefined || large_read_mode(run.context) !== 'refuse') return false

	return !is_repeat_of_refusal(tail, target, cwd)
}

function notifies(tail: string, _call: GuardedCall, fired_at_ms: number, run: GuardRun): boolean {
	return large_read_mode(run.context) === 'notice' && is_rearmed(tail, fired_at_ms)
}

const GUARD = hook_decision.create_transcript_guard({
	prefix: STAMP_PREFIX,
	switch_key: SWITCH_ENV_KEY,
	is_candidate,
	should_block: refuses,
	reason: REASON,
	notify: { prefix: NOTICE_STAMP_PREFIX, should_notify: notifies, text: () => NOTICE },
})

const large_read_outcome = GUARD.outcome
const large_read_refusal = GUARD.refusal
const { refusal_path } = GUARD
const notice_refusal_path = hook_decision.create_refusal_stamp(NOTICE_STAMP_PREFIX).path

const large_reads = { REASON, NOTICE, LARGE_READ_BYTES }

export {
	large_read_outcome,
	large_read_refusal,
	large_reads,
	notice_refusal_path,
	refusal_path,
	SWITCH_ENV_KEY,
}
