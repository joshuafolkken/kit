import { lane_child_marker, type MarkerSource } from './lane-child-marker'

// How each `PreToolUse` guard behaves in a dispatched lane child, as an enumeration rather than a
// judgement (joshuafolkken/kit#2138, joshuafolkken/kit#2164).
//
// **The three guards were built for the interactive main line, where a refusal is guidance.** A denial
// rewrites the next move of a person's session. A dispatched lane child is a headless `claude -p`
// process, so a *denial* ends the conversation with nothing committed — joshuafolkken/kit#2138 measured
// a child killed before its commit by two investigation refusals and one batching refusal, every one of
// them a read of a file the child was about to edit. So a guard whose correction is a denial cannot fire
// as one in a child.
//
// **But a denial is not the only way a guard can speak, and that is what kit#2164 corrects.** A guard
// can also raise a *notice* — a non-blocking `additionalContext` that carries the same guidance without
// a `permissionDecision`, so the turn is never ended. The lane child holds the most expensive runs
// (64% of measured cost), and taking the batching guard entirely off there is what let the run's tool
// density fall to one call per turn. So the choice is three-valued, not two:
//
//   - `refuse` — deny the call (the main-line default; the child keeps this for the safety rules).
//   - `notice` — let the call through but attach the guidance, so a headless child is nudged, not killed.
//   - `off`    — say nothing at all, for a guard whose remedy the child cannot carry out.
//
// **It is an enumeration and not a judgement, for the reason `delegation-policy.ts` is one.** "This
// guard's mode in a child" is a call made under the same pressure that produced the misfire. The list is
// the whole of it, and a guard nobody classified refuses — the safe direction, since a wrongly-silenced
// rule ships unnoticed while a wrongly-kept one costs at most the one round trip the child already
// survived once. `lane-guard-policy.test.ts` pins that the enumeration and the guards' live behavior
// cannot disagree.

// The three ways a guard may behave in a lane child (joshuafolkken/kit#2164). Outside a lane child every
// guard is `refuse`, which is why that is also the fail-safe default below.
type LaneGuardMode = 'refuse' | 'notice' | 'off'
type LaneGuardId = 'investigation' | 'batching' | 'rule'

// The mode outside a lane child, and the fail-safe for a guard nobody enumerated: a denial, the same
// direction `delegation-policy.ts` takes, because a silenced rule is the one mistake that ships unseen.
const DEFAULT_MODE: LaneGuardMode = 'refuse'
const OFF_MODE: LaneGuardMode = 'off'

interface LaneGuardEntry {
	id: LaneGuardId
	// How this guard behaves when the session is a dispatched lane child.
	mode_in_lane_child: LaneGuardMode
	// Why. A mode with no reason is a choice nobody can check; the reason names what the child still needs
	// the guard for, or why the guard cannot fire as a refusal there.
	because: string
}

const LANE_GUARD_POLICY: ReadonlyArray<LaneGuardEntry> = [
	{
		id: 'investigation',
		mode_in_lane_child: 'off',
		because:
			'the child is itself the delegated unit the refusal asks for — it cannot dispatch a sub-unit to read its own edit targets, and the remedy the reason names does not exist for it, so even a notice would carry guidance the child cannot act on',
	},
	{
		id: 'batching',
		mode_in_lane_child: 'notice',
		because:
			'the reissue-in-one-turn correction is guidance a child can act on — batch the next calls — but a *refusal* ends its turn instead of guiding it, so kit#2164 delivers it as a non-blocking notice: the child is nudged toward batching without being killed, and the lane child is where the cost this whole guard exists to cut is largest',
	},
	{
		id: 'rule',
		mode_in_lane_child: 'refuse',
		because:
			'it carries the lane-only rules a child depends on (`pre-gate-cut`, `lane-park`) and the safety rules a child must still obey (`shell-body`, `piped-verification`); a blanket suppression would disarm exactly the guards written for the child',
	},
]

const KNOWN_GUARD_IDS: ReadonlyArray<LaneGuardId> = LANE_GUARD_POLICY.map((entry) => entry.id)

function entry_for(id: string): LaneGuardEntry | undefined {
	return LANE_GUARD_POLICY.find((entry) => entry.id === id.trim())
}

// **An unenumerated guard refuses**, the same fail-safe direction `delegation-policy.ts` takes: a guard
// nobody listed keeps the main-line default rather than being silently downgraded, because a downgrade
// is what ships a missed rule.
function mode_in_lane_child(id: string): LaneGuardMode {
	return entry_for(id)?.mode_in_lane_child ?? DEFAULT_MODE
}

// The mode that applies to this guard right now. Outside a lane child every guard is `refuse`; inside
// one it is the enumerated mode. A guard whose lane-child mode is already `refuse` reads the same either
// way, so the marker — the dispatch mark against this checkout's own issue — is consulted only for a
// guard the enumeration would actually change, never on every call.
function mode_here(
	id: string,
	directory: string = process.cwd(),
	source: MarkerSource = process.env,
): LaneGuardMode {
	const lane_mode = mode_in_lane_child(id)

	if (lane_mode === DEFAULT_MODE) return DEFAULT_MODE

	return lane_child_marker.is_child_of(directory, source) ? lane_mode : DEFAULT_MODE
}

// True when this guard must say nothing at all because the session is a dispatched lane child — the
// `off` mode alone. A `notice`-mode guard is not suppressed: it still speaks, just without a
// `permissionDecision`, so this must not answer `true` for it.
function is_suppressed_here(
	id: string,
	directory: string = process.cwd(),
	source: MarkerSource = process.env,
): boolean {
	return mode_here(id, directory, source) === OFF_MODE
}

const lane_guard_policy = {
	LANE_GUARD_POLICY,
	KNOWN_GUARD_IDS,
	entry_for,
	mode_in_lane_child,
	mode_here,
	is_suppressed_here,
}

export type { LaneGuardEntry, LaneGuardId, LaneGuardMode }
export { lane_guard_policy }
