import { hook_decision } from '#scripts/josh/hook-decision'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { z } from 'zod'
import { run_progress_read } from './run-progress-read'
import { run_watcher_guard } from './run-watcher-guard'

// The `PreToolUse` adapter that turns `run_watcher_guard`'s verdict into a deny reason, so the guard
// the CLI already carries is finally *called* on every tool call rather than left to prose asking the
// run to call it (joshuafolkken/kit#2353). It is composed into `pretool-guard.ts` — the one PreToolUse
// hook, kept one by joshuafolkken/kit#1930 — rather than added as a second `.claude/settings.json`
// entry, so the consolidation invariant holds; the detection itself is unchanged.
//
// **It fires once per run, for the same reason every guard here stamps.** A stale watcher would other-
// wise refuse *every* tool call, including the `pnpm josh run:progress --wait` that fixes it — a wedge.
// So the first stale call is refused and that refusal is recorded; the next call, the restart, is
// allowed. Restarting the watcher pings its life record fresh, so the guard falls silent on its own.
//
// **A dispatched lane child is exempt.** Only the outermost run keeps a watcher (`run-progress-cli.ts`),
// so a child carrying `JOSH_LANE_CHILD` must not be refused for a watcher it was never meant to start.

const SWITCH_ENV_KEY = 'JOSH_WATCHER_GUARD'
const STAMP_PREFIX = 'josh-watcher-guard-'

const payload_schema = z.object({ transcript_path: z.string().min(1) })

function transcript_of(raw_payload: string): string | undefined {
	try {
		const parsed = payload_schema.safeParse(JSON.parse(raw_payload))

		return parsed.success ? parsed.data.transcript_path : undefined
	} catch {
		return undefined
	}
}

// The once-per-run arm: refuse only when nothing has been recorded yet, and record before returning so
// the refusal cannot repeat on the call in hand. A record that cannot be written allows the call — the
// fail-open direction the transcript guards take for the same reason.
function fires_once(transcript: string, now_ms: number): boolean {
	const stamp = hook_decision.create_refusal_stamp(STAMP_PREFIX)
	const target = stamp.path(transcript)

	if (stamp.last_ms(target) !== hook_decision.NEVER_MS) return false

	return stamp.record(target, now_ms)
}

// The guard is off when its switch is disabled or when this session is a dispatched lane child, which
// runs no watcher of its own.
function is_active(): boolean {
	return (
		hook_decision.is_switch_enabled(SWITCH_ENV_KEY) &&
		lane_child_marker.marked_issue() === undefined
	)
}

// The guard's note when the watcher is stale and this call is the once-per-run one that refuses, or
// `undefined` when the watcher is fresh (or the refusal was already spent this run).
async function stale_reason(transcript: string, now_ms: number): Promise<string | undefined> {
	const result = await run_watcher_guard.check(await run_progress_read.live_target())

	if (result.kind === 'ok') return undefined

	return fires_once(transcript, now_ms) ? result.note : undefined
}

// The deny reason for a tool call that arrives while lane children are in-flight and the watcher has
// gone stale, or `undefined` when the call proceeds. Async because the lane listing and the life
// record are read from disk; the composing hook already awaits.
async function watcher_hook_reason(
	raw_payload: string,
	now_ms: number = Date.now(),
): Promise<string | undefined> {
	if (!is_active()) return undefined

	const transcript = transcript_of(raw_payload)

	if (transcript === undefined) return undefined

	return await stale_reason(transcript, now_ms)
}

const run_watcher_hook = { SWITCH_ENV_KEY, STAMP_PREFIX, watcher_hook_reason }

export { run_watcher_hook }
