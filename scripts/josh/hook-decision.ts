import type { GuardedCall } from '#scripts/time/time-batch-guard'
import { time_density_hook } from '#scripts/time/time-density-hook'
import { time_hook_transcript } from '#scripts/time/time-hook-transcript'
import { z } from 'zod'
import { josh_environment_file } from './josh-environment-file'
import { stamp_file } from './stamp-file'

// The parts every refusing `PreToolUse` hook needs, held once (joshuafolkken/kit#1460).
//
// **It exists because the second such hook arrived.** `batch-guard.ts` was the first
// (joshuafolkken/kit#1390) and carried the whole shell itself: the payload schema, the envelope
// Claude Code understands, the environment switch, and the stamp that makes a refusal
// unrepeatable. The investigation guard needs all four unchanged and only its *rule* differs, so
// copying them across would be the clone `CLAUDE.md` prohibits — and a rule fixed in one copy and
// not the other is the failure that prohibition is about.
//
// **Nothing here decides anything.** Which calls are candidates, what the tail has to say and what
// the refusal reads are each hook's own; this file is the plumbing they were both spelling out.

// Only the four fields a `PreToolUse` hook is handed and reads. Claude Code names the tool it is
// about to run beside a transcript path, so nothing is searched for.
//
// **`agent_id` is what makes a delegated unit answerable with its own file** (joshuafolkken/kit#1424).
// The path in the payload is the *parent* session's whichever agent issued the call, so without this
// field a guard judges the parent's frozen timeline and refuses nothing at all inside a fork.
const payload_schema = z.object({
	transcript_path: z.string().min(1),
	// **`nullish`, not `optional`.** A payload spelling the absent agent as `null` has to read as "no
	// fork"; rejected, it would fail `safeParse` for the whole payload and take the guard off every
	// call of the main line, in silence — the failure every other path here is written to avoid.
	agent_id: z.string().nullish(),
	tool_name: z.string().min(1),
	tool_input: z.unknown(),
})
const refusal_schema = z.object({ refused_at_ms: z.number() })

type HookPayload = z.infer<typeof payload_schema>

const HOOK_EVENT_NAME = 'PreToolUse'
const DENY_DECISION = 'deny'
// No record means nothing has been refused yet, and every span began after instant zero — which is
// the answer wanted: the first qualifying accumulation of a run is refused.
const NEVER_MS = 0

// More than one spelling, because the mistake on this side is silent: a value meant to disable a
// guard that the list does not recognize leaves it on, and the person sees refusals they asked to
// stop.
const DISABLED_VALUES: ReadonlyArray<string> = ['off', '0', 'false', 'no']

// **Read at call time, never cached at module load.** A suite that switches the variable between
// cases — and both hooks' suites do — sees a cached answer as the guard ignoring the switch.
function is_switch_enabled(key: string): boolean {
	return !DISABLED_VALUES.includes((process.env[key] ?? '').trim().toLowerCase())
}

function parse_hook_payload(raw_payload: string): HookPayload | undefined {
	const parsed = payload_schema.safeParse(JSON.parse(raw_payload))

	return parsed.success ? parsed.data : undefined
}

// The documented shape a `PreToolUse` hook answers with. Plain stdout is not it — only this envelope
// stops the call, and only `permissionDecisionReason` reaches the model.
function deny_envelope(reason: string): string {
	return JSON.stringify({
		hookSpecificOutput: {
			hookEventName: HOOK_EVENT_NAME,
			permissionDecision: DENY_DECISION,
			permissionDecisionReason: reason,
		},
	})
}

interface RefusalStamp {
	path: (transcript_path: string) => string
	last_ms: (target: string) => number
	// **Recording is what makes a refusal unrepeatable, so a refusal that could not be recorded is
	// not made.** With nothing written, every later look at the same accumulation qualifies, the same
	// call is refused again, and the run is wedged. Arming first and refusing second turns that from
	// unlikely into impossible, which is why this answers whether it wrote.
	record: (target: string, now_ms: number) => boolean
}

// A record that is absent, unreadable, planted by another account or not the shape written here all
// answer `NEVER_MS`. That direction is the permissive one for a run's first refusal and the dangerous
// one for every later look at the same accumulation, which `record_refusal` is placed in front of.
function last_refusal_ms(target: string): number {
	const raw = stamp_file.read_stamp_text(target)

	if (raw === undefined) return NEVER_MS

	try {
		return refusal_schema.parse(JSON.parse(raw)).refused_at_ms
	} catch {
		return NEVER_MS
	}
}

function record_refusal(target: string, now_ms: number): boolean {
	try {
		stamp_file.write_stamp(target, { refused_at_ms: now_ms })

		return true
	} catch {
		return false
	}
}

// One record per session, keyed on the transcript the payload named — what is being tracked is a
// *run*, and a delegated child is a run of its own. Only the prefix differs between hooks, which is
// why that is the whole of what this closes over.
function create_refusal_stamp(prefix: string): RefusalStamp {
	function path(transcript_path: string): string {
		return stamp_file.stamp_path(prefix, transcript_path)
	}

	return { path, last_ms: last_refusal_ms, record: record_refusal }
}

// **`.env` is loaded here rather than through the dispatcher's `tsx_arguments`**, and the reason —
// declaring any `tsx_arguments` disqualifies a command from in-process dispatch — is now shared with
// every other command that has to stay in-process, so the loader lives in `josh-environment-file.ts` rather
// than here (joshuafolkken/kit#1491). Re-exported under this namespace because that is where the
// hooks reach for it.
//
// **Call it only on the real hook path**, never inside the pure refusal function, so a developer's
// own `.env` cannot decide what the unit tests see.
const { load_environment_file } = josh_environment_file

// What one refusing hook differs from another by, and nothing else. Both existing hooks judge the
// call, derive the transcript, read its tail, ask their own rule and record before refusing — the
// same six steps in the same order — so those steps are here and the three fields below are what a
// hook supplies.
// What a rule may need about the run rather than about the call in hand.
interface GuardRun {
	transcript: string
	now_ms: number
}

interface TranscriptGuardSpec {
	// Keeps one hook's refusal record out of the other's.
	prefix: string
	// The environment variable that switches this hook off, so one being off leaves the other on.
	switch_key: string
	// Whether this call is one the hook may refuse at all, judged **before** the transcript is read:
	// most of a run's calls are ones the hook could never refuse, and a quarter-megabyte tail read for
	// each of them would be paid inside a hook that is holding the call.
	is_candidate: (call: GuardedCall) => boolean
	// This hook's own rule, over the tail. `run` carries what a rule may need about the *run* rather
	// than about the call — the transcript the stamps are keyed on, and the instant this decision is
	// being made — because a rule may have to ask what **another** hook has already recorded, and
	// whether that record is about the call in hand or an earlier one. A rule that needs neither is
	// free to declare three parameters and ignore it.
	should_block: (tail: string, call: GuardedCall, refused_at_ms: number, run: GuardRun) => boolean
	// What the model is told. The deny reason is the only text that reaches it.
	reason: string
}

interface TranscriptGuard {
	is_enabled: () => boolean
	refusal_path: (transcript_path: string) => string
	refusal: (raw_payload: string, now_ms?: number) => string | undefined
}

function guard_reason_for_payload(
	spec: TranscriptGuardSpec,
	stamp: RefusalStamp,
	payload: HookPayload,
	now_ms: number,
): string | undefined {
	const call = { name: payload.tool_name, input: payload.tool_input }

	if (!spec.is_candidate(call)) return undefined

	// A hook firing inside a delegated unit is handed the *parent's* path, so the fork's own file is
	// derived here rather than judged from the parent's frozen timeline (joshuafolkken/kit#1424).
	const transcript = time_hook_transcript.transcript_of(payload.transcript_path, payload.agent_id)
	const target = stamp.path(transcript)
	const tail = time_density_hook.read_tail(transcript)

	const run = { transcript, now_ms }

	if (!spec.should_block(tail, call, stamp.last_ms(target), run)) return undefined
	if (!stamp.record(target, now_ms)) return undefined

	return spec.reason
}

function guard_reason(
	spec: TranscriptGuardSpec,
	stamp: RefusalStamp,
	raw_payload: string,
	now_ms: number,
): string | undefined {
	const payload = parse_hook_payload(raw_payload)

	if (payload === undefined || !is_switch_enabled(spec.switch_key)) return undefined

	return guard_reason_for_payload(spec, stamp, payload, now_ms)
}

function create_transcript_guard(spec: TranscriptGuardSpec): TranscriptGuard {
	const stamp = create_refusal_stamp(spec.prefix)

	function is_enabled(): boolean {
		return is_switch_enabled(spec.switch_key)
	}

	function refusal_path(transcript_path: string): string {
		return stamp.path(transcript_path)
	}

	// **Every failure allows the call.** A missing transcript, a payload that is not JSON, a
	// half-written tail, a temp directory that cannot be written — each ends as "no refusal", for the
	// same reason `format-edited-file.ts` swallows a formatter it could not start: a hook that failed
	// closed would stop a run over its own plumbing.
	function refusal(raw_payload: string, now_ms: number = Date.now()): string | undefined {
		try {
			return guard_reason(spec, stamp, raw_payload, now_ms)
		} catch {
			return undefined
		}
	}

	return { is_enabled, refusal, refusal_path }
}

// Nothing at all reaches stdout on the ordinary call, so what the harness parses stays empty unless
// the call is being refused.
function write_decision(raw_payload: string, refusal: (raw: string) => string | undefined): void {
	load_environment_file()

	const reason = refusal(raw_payload)

	if (reason !== undefined) process.stdout.write(`${deny_envelope(reason)}\n`)
}

// Run from a terminal there is no payload coming, and waiting for one looks like a hang.
function report_no_payload(command: string): void {
	process.stderr.write(
		`${command} reads a Claude Code PreToolUse payload on stdin; it is not run by hand.\n`,
	)
}

const hook_decision = {
	DISABLED_VALUES,
	NEVER_MS,
	create_refusal_stamp,
	create_transcript_guard,
	deny_envelope,
	is_switch_enabled,
	load_environment_file,
	parse_hook_payload,
	report_no_payload,
	write_decision,
}

export type { GuardRun, HookPayload, RefusalStamp, TranscriptGuard, TranscriptGuardSpec }
export { hook_decision }
