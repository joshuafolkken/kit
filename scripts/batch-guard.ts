#!/usr/bin/env tsx
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { ENV_FILE_NAME } from '#ports'
import { stamp_file } from '#scripts/josh/stamp-file'
import { z } from 'zod'
import { time_batch_guard } from './time/time-batch-guard'
import { time_density_hook } from './time/time-density-hook'

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
// **Every failure here allows the call.** A missing transcript, a payload that is not JSON, a
// half-written tail, a temp directory that cannot be written — each of them ends as "no refusal", for
// the same reason `format-edited-file.ts` swallows a formatter it could not start: a hook that fails
// closed would stop a run over its own plumbing. The one failure worth naming separately is the stamp,
// below.

const HOOK_EVENT_NAME = 'PreToolUse'
const DENY_DECISION = 'deny'
// **One record per session, keyed on the transcript the payload named**, exactly as the density
// notice's is and for the same reason: what is being tracked is a *run*, and a delegated child is a
// run of its own.
const REFUSAL_PREFIX = 'josh-batch-guard-'
// No record means nothing has been refused yet, and every sequence began after instant zero — which
// is the answer wanted: the first qualifying sequence of a run is refused.
const NEVER_MS = 0

// The escape hatch. **On by default**, unlike `JOSH_EVAL`: this is a distributed convention rather
// than an opt-in measurement, and a guard nobody enables would leave the Issue exactly where it
// started. What the variable buys is a way to switch a refusing hook off without editing the settings
// file — a machine debugging the guard itself, or a session where a run of genuinely dependent single
// calls is expected.
const SWITCH_ENV_KEY = 'JOSH_BATCH_GUARD'
// More than one spelling, because the mistake on this side is silent: a value meant to disable the
// guard that the list does not recognize leaves it on, and the person sees refusals they asked to stop.
const DISABLED_VALUES: ReadonlyArray<string> = ['off', '0', 'false', 'no']

// Only the three fields this reads. Claude Code hands a `PreToolUse` hook the tool it is about to run
// beside the session's own transcript path, so nothing is searched for and a delegated unit is
// answered with its own file rather than its parent's.
const payload_schema = z.object({
	transcript_path: z.string().min(1),
	tool_name: z.string().min(1),
	tool_input: z.unknown(),
})
const refusal_schema = z.object({ refused_at_ms: z.number() })

type GuardPayload = z.infer<typeof payload_schema>

function is_enabled(): boolean {
	return !DISABLED_VALUES.includes((process.env[SWITCH_ENV_KEY] ?? '').trim().toLowerCase())
}

function parse_payload(raw_payload: string): GuardPayload | undefined {
	const parsed = payload_schema.safeParse(JSON.parse(raw_payload))

	return parsed.success ? parsed.data : undefined
}

function refusal_path(transcript_path: string): string {
	return stamp_file.stamp_path(REFUSAL_PREFIX, transcript_path)
}

// A record that is absent, unreadable, planted by another account or not the shape written here all
// answer `NEVER_MS`. That direction is the permissive one for the *first* refusal of a run and the
// dangerous one for every later look at the same sequence, which is what `record_refusal` below is
// placed in front of.
function last_refusal_ms(source: string): number {
	const raw = stamp_file.read_stamp_text(source)

	if (raw === undefined) return NEVER_MS

	try {
		return refusal_schema.parse(JSON.parse(raw)).refused_at_ms
	} catch {
		return NEVER_MS
	}
}

// **Recording the refusal is what makes it unrepeatable, so a refusal that could not be recorded is
// not made.** The sequence a refused call belongs to is not restarted by the refusal — the call
// extends it — so the next look at that same run of single-call turns is admitted only by the recorded
// instant. With nothing written, every look qualifies, the same call is refused again, and the run is
// wedged. Arming first and refusing second is what turns that from unlikely into impossible.
function record_refusal(target: string, now_ms: number): boolean {
	try {
		stamp_file.write_stamp(target, { refused_at_ms: now_ms })

		return true
	} catch {
		return false
	}
}

// **The call is judged before the transcript is read.** Most of a run's `Bash` calls are writes the
// guard could never refuse — `pnpm josh`, `git`, a `gh` write — and reading a quarter-megabyte tail for
// each of them would be paid inside a hook that holds the call it is judging.
function refusal_for_payload(payload: GuardPayload, now_ms: number): string | undefined {
	const call = { name: payload.tool_name, input: payload.tool_input }

	if (!time_batch_guard.is_guarded_call(call)) return undefined

	const target = refusal_path(payload.transcript_path)
	const tail = time_density_hook.read_tail(payload.transcript_path)

	if (!time_batch_guard.should_block(tail, call, last_refusal_ms(target))) return undefined
	if (!record_refusal(target, now_ms)) return undefined

	return time_batch_guard.REASON
}

function refusal_for(raw_payload: string, now_ms: number): string | undefined {
	const payload = parse_payload(raw_payload)

	if (payload === undefined || !is_enabled()) return undefined

	return refusal_for_payload(payload, now_ms)
}

// The whole call in one guard: every path above may throw on a file that moved or a payload that is
// not JSON, and neither is worth refusing a tool call over.
function batch_refusal(raw_payload: string, now_ms: number = Date.now()): string | undefined {
	try {
		return refusal_for(raw_payload, now_ms)
	} catch {
		return undefined
	}
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

// **`.env` is loaded here rather than through the dispatcher's `tsx_arguments`.** The flag form is what
// every other command uses, but declaring any `tsx_arguments` disqualifies a command from in-process
// dispatch (`josh-in-process.ts`) — putting a second ~0.16 s tsx start back in front of every `Bash`
// call, which is the hot path joshuafolkken/kit#1342 took it off. `process.loadEnvFile` is node's own
// `--env-file` parser, verified to keep node's precedence: a value already in the environment wins over
// the file's. A missing or unreadable file is what `--env-file-if-exists` swallows, and so does this.
//
// **It runs only on the real hook path**, never inside `batch_refusal`, so a developer's own `.env`
// cannot decide what the unit tests see.
function load_environment_file(): void {
	try {
		process.loadEnvFile(ENV_FILE_NAME)
	} catch {
		// No `.env` beside this project, or one this process may not read. The switch then reads from the
		// environment alone, which is what it did before any file existed.
	}
}

// Nothing at all reaches stdout on the ordinary call, so what the harness parses stays empty unless
// the call is being refused.
function write_decision(raw_payload: string): void {
	load_environment_file()

	const reason = batch_refusal(raw_payload)

	if (reason !== undefined) process.stdout.write(`${deny_envelope(reason)}\n`)
}

// Run from a terminal there is no payload coming, and waiting for one looks like a hang.
function report_no_payload(): void {
	process.stderr.write(
		'batch:guard reads a Claude Code PreToolUse payload on stdin; it is not run by hand.\n',
	)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (process.stdin.isTTY) report_no_payload()
	else write_decision(await text(process.stdin))
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
