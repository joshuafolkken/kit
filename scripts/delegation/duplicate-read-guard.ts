#!/usr/bin/env tsx
import { statSync } from 'node:fs'
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { hook_decision } from '#scripts/josh/hook-decision'
import { lane_guard_policy, type LaneGuardMode } from '#scripts/lane/lane-guard-policy'
import { json_value } from '#scripts/lib/json-value'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { time_spans, type Span } from '#scripts/time-runtime/time-spans'
import { investigation_reads } from './investigation-reads'

// Refuse the second whole-file `Read` of a path whose content has not changed since the run last read
// it (joshuafolkken/kit#2298). Measured across the latest five lanes, a run re-read the same unchanged
// path 8.0 times on average — `#2282` read `pre-gate-cut.md` three times — and each round trip pays
// ~17 seconds to return text the run already holds. The remedy is the one `investigation-guard.ts`
// already proved: intervene in the `PreToolUse` decision rather than describe the rule in prose.
//
// **It is unchanged content that is caught, never a repeat read.** The transcript says *when* the run
// last read the path; the filesystem says *whether* it has changed since. A file whose `mtime` is
// newer than that read has been edited — or merged, or grown by a background task — so the re-read is
// let through; only a file untouched since the read returns nothing new. Reading the change off the
// disk rather than off the transcript is what makes an edit, a `git` checkout and a `tasks/*.output`
// that grew all read the same: any of them moves the `mtime`.
//
// **How it speaks is decided by the one-place lane enumeration, exactly as the batching guard's is.**
// On the interactive main line a refusal is guidance, so the guard `refuse`s; in a dispatched lane
// child a denial ends the headless turn with nothing committed (joshuafolkken/kit#2138), and the
// duplicates the Issue measured are in those very children — so there it is a `notice`, nudging the run
// without killing it. `lane-guard-policy.ts` is the single source of both modes.
//
// **The escape hatch is on by default**, for `investigation-guard.ts`'s reason: a distributed guard
// nobody enables leaves the Issue where it started. The variable buys a way to switch it off without
// editing the settings file — debugging the guard, or a session whose re-reads really are all needed.
const SWITCH_ENV_KEY = 'JOSH_DUPLICATE_READ_GUARD'
const LANE_GUARD_ID = 'duplicate-read'
const STAMP_PREFIX = 'josh-duplicate-read-guard-'
const NOTICE_STAMP_PREFIX = 'josh-duplicate-read-notice-'
const READ_TOOL = 'Read'
// A glob resolves to a literal path with a `*` in it, which names no single file to stat.
const GLOB_CHARACTERS = /[*?]/u

// What the refusal tells the model — the deny reason is the only text that reaches it, so it has to
// name why the read was stopped and how to proceed. A run refused and told nothing reads it as a
// broken tool.
const REASON = `⛔ duplicate read: this file was already read in this session and has not changed since (its mtime predates that read), so reading it again returns nothing new. Scroll up to the earlier result instead of re-reading it. A read with a new offset/limit, or of a file that has since changed, is allowed; set \`JOSH_DUPLICATE_READ_GUARD=off\` to disable this guard.`

// The same guidance carried without a `permissionDecision`, for a dispatched lane child where a denial
// would end the turn (joshuafolkken/kit#2138). It nudges rather than blocks, so the run survives.
const NOTICE = `⚠ duplicate read: this file was already read in this session and has not changed since, so re-reading it returns nothing new — scroll up to the earlier result instead of re-reading it. Set \`JOSH_DUPLICATE_READ_GUARD=off\` to silence this.`

// **A paginated read is a read of a different region, not a repeat.** A run that read lines 1–100 and
// now wants 101–200 needs the second call, so a read carrying an `offset` or a `limit` is never the
// whole-file re-read this guard is about — the count the Issue measured is whole-file reads.
function is_paginated(input: Record<string, unknown>): boolean {
	return input['offset'] !== undefined || input['limit'] !== undefined
}

// A `file_path` that names one readable file: a non-empty string that is not a glob. A glob resolves
// to a literal path with a `*` in it, which names no single file to stat.
function names_one_file(file_path: unknown): file_path is string {
	return typeof file_path === 'string' && file_path !== '' && !GLOB_CHARACTERS.test(file_path)
}

// The absolute path of a refusable whole-file `Read`, or `undefined` for any call this guard leaves
// alone: a non-`Read` tool, a paginated read, or a target that names no single file. Resolved through
// `investigation-reads.ts` so the two ways a path reaches here — a tool field and a transcript span —
// compare as one string.
function read_target(call: GuardedCall): string | undefined {
	if (call.name !== READ_TOOL || !json_value.is_record(call.input)) return undefined

	const { input } = call

	if (is_paginated(input) || !names_one_file(input['file_path'])) return undefined

	return investigation_reads.resolved(input['file_path'])
}

function is_refusable_call(call: GuardedCall): boolean {
	return read_target(call) !== undefined
}

// A read the run made and that returned — a denied or errored read carried no text into the prompt, so
// it is not a read this guard measures against. It is `investigation-reads.ts`'s own exclusion, asked
// here of a `Read` span alone.
function is_successful_read(span: Span): boolean {
	const is_read = investigation_reads.READ_TOOLS.has(span.label)

	return is_read && span.outcome !== time_spans.FAILED_OUTCOME
}

function reads_target(span: Span, target: string): boolean {
	return span.targets.some((one) => investigation_reads.resolved(one) === target)
}

// **The instant the run last read this exact path, or `NEVER_MS` where the tail holds no such read.**
// The most recent successful read wins: an earlier read that has since been superseded says nothing
// about whether the content is current. The tail is the same bounded window the other guards read, so
// a first read that has scrolled out reads as "never read" — a miss, never a false refusal.
function last_read_ms(spans: ReadonlyArray<Span>, target: string): number {
	const times = spans
		.filter((span) => is_successful_read(span) && reads_target(span, target))
		.map((span) => span.ended_ms)

	return times.length === 0 ? hook_decision.NEVER_MS : Math.max(...times)
}

// The file's modification time in epoch milliseconds, comparable to a span's `ended_ms` because both
// are this machine's wall clock. **A stat that fails allows the call** — a deleted or unreadable file
// is not something to refuse over, and "could not read mtime/size" is the fallback the Issue names.
function file_mtime_ms(target: string): number | undefined {
	try {
		return statSync(target).mtimeMs
	} catch {
		return undefined
	}
}

// What the rule needs about the run: when the target was last read, and when the window opens.
interface ReadWindow {
	last_ms: number
	window_start_ms: number
}

function read_window(tail: string, target: string): ReadWindow {
	const { spans, started_ms } = time_spans.parse_timeline(tail)

	return { last_ms: last_read_ms(spans, target), window_start_ms: started_ms }
}

// **The re-read returns nothing new.** The path was read before (`last_ms` is set) and the file has
// not changed since (`mtime` predates that read). A missing stat is not "unchanged" — it is the
// fallback that allows the call.
function is_unchanged_reread(last_ms: number, mtime: number | undefined): boolean {
	if (mtime === undefined || last_ms === hook_decision.NEVER_MS) return false

	return mtime < last_ms
}

// **One firing per accumulation, re-armed by a later read and by nothing else.** A run spoken to once
// and reading on anyway is not spoken to again — a false positive costs one round trip, never the wedge
// of the same call flagged on every look. It re-arms when a fresh successful read of the target lands
// after the last firing (a new redundant episode), or when that firing has scrolled out of the window,
// which is `investigation-reads.ts`'s own pair of arms. `fired_at_ms` is the refusal's stamp on the
// main line and the notice's own stamp in a lane child, so the two dedupe independently.
function is_rearmed(window: ReadWindow, fired_at_ms: number): boolean {
	if (fired_at_ms === hook_decision.NEVER_MS || fired_at_ms < window.window_start_ms) return true

	return window.last_ms > fired_at_ms
}

// The pure rule, shared by the refusal and the notice: is this call an unchanged re-read that the
// enumeration's mode should act on, given whatever this disposition last fired at.
function is_redundant_reread(tail: string, call: GuardedCall, fired_at_ms: number): boolean {
	const target = read_target(call)

	if (target === undefined) return false

	const window = read_window(tail, target)

	if (!is_unchanged_reread(window.last_ms, file_mtime_ms(target))) return false

	return is_rearmed(window, fired_at_ms)
}

// **How this guard behaves for the session in hand, from the one-place enumeration** — `refuse` on the
// main line, `notice` in a dispatched lane child (joshuafolkken/kit#2298). The enumeration reads the
// dispatch mark against this checkout's own issue only for a mode it would change, so a person working
// in a lane sees the guard refuse exactly as the main line does.
function duplicate_mode(): LaneGuardMode {
	return lane_guard_policy.mode_here(LANE_GUARD_ID)
}

// A candidate call is reached unless the enumeration turns the guard fully `off`; today no mode does,
// but the three-valued wrapper keeps that a change to the enumeration rather than to this file.
function is_candidate(call: GuardedCall): boolean {
	return is_refusable_call(call) && duplicate_mode() !== 'off'
}

// A refusable call is refused only where the mode is `refuse`. A lane child is `notice`, so it reaches
// here and is withheld the refusal — the notice branch carries the guidance instead, because a refusal
// ends a headless child's turn (joshuafolkken/kit#2138).
function should_block_here(tail: string, call: GuardedCall, refused_at_ms: number): boolean {
	if (duplicate_mode() !== 'refuse') return false

	return is_redundant_reread(tail, call, refused_at_ms)
}

// The `notice`-mode branch, reached in a dispatched lane child. It reads the notice's own last-fired
// instant, so a notice never spends the refusal's stamp and re-arms on the same "a newer read landed"
// rule the refusal does.
function should_notify_here(tail: string, call: GuardedCall, notified_at_ms: number): boolean {
	if (duplicate_mode() !== 'notice') return false

	return is_redundant_reread(tail, call, notified_at_ms)
}

const GUARD = hook_decision.create_transcript_guard({
	prefix: STAMP_PREFIX,
	switch_key: SWITCH_ENV_KEY,
	is_candidate,
	should_block: should_block_here,
	reason: REASON,
	notify: {
		prefix: NOTICE_STAMP_PREFIX,
		should_notify: should_notify_here,
		text: () => NOTICE,
	},
})

const duplicate_read_refusal = GUARD.refusal
const duplicate_read_outcome = GUARD.outcome
const { is_enabled, refusal_path } = GUARD
const notice_refusal_path = hook_decision.create_refusal_stamp(NOTICE_STAMP_PREFIX).path
const { deny_envelope, DISABLED_VALUES } = hook_decision

const duplicate_reads = {
	REASON,
	NOTICE,
	SWITCH_ENV_KEY,
	is_candidate,
	is_rearmed,
	is_redundant_reread,
	is_refusable_call,
	is_unchanged_reread,
	last_read_ms,
	read_target,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (process.stdin.isTTY) hook_decision.report_no_payload('duplicate-read:guard')
	else hook_decision.write_outcome(await text(process.stdin), duplicate_read_outcome)
}

export {
	deny_envelope,
	DISABLED_VALUES,
	duplicate_read_outcome,
	duplicate_read_refusal,
	duplicate_reads,
	is_enabled,
	notice_refusal_path,
	refusal_path,
	SWITCH_ENV_KEY,
}
