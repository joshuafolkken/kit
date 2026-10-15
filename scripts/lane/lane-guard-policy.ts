import { lane_child_marker, type MarkerSource } from './lane-child-marker'

// How each `PreToolUse` guard behaves in a dispatched lane child, as an enumeration rather than a
// judgement.
//
// **The three guards were built for the interactive main line, where a refusal is guidance.** A denial
// rewrites the next move of a person's session. A dispatched lane child is a headless `claude -p`
// process, so a *denial* ends the conversation with nothing committed. So a guard whose correction is a
// denial cannot fire as one in a child.
//
// **But a denial is not the only way a guard can speak.** A guard can also raise a *notice* — a
// non-blocking `additionalContext` that carries the same guidance without a `permissionDecision`, so the
// turn is never ended. So the choice is three-valued, not two:
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

// The three ways a guard may behave in a lane child. Outside a lane child every
// guard is `refuse`, which is why that is also the fail-safe default below.
type LaneGuardMode = 'refuse' | 'notice' | 'off'
type LaneGuardId = 'investigation' | 'batching' | 'rule' | 'duplicate-read'

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
		mode_in_lane_child: 'notice',
		because:
			'a refusal ends a child turn, yet lane children were measured reading files they never edited, so the child is nudged to delegate by a notice rather than killed',
	},
	{
		id: 'batching',
		mode_in_lane_child: 'off',
		because:
			'a refusal ends a child turn and every advisory notice was measured not to move the call density, so the guard is off and the density stays readable through `josh time:density`',
	},
	{
		id: 'duplicate-read',
		mode_in_lane_child: 'notice',
		because:
			'a refusal ends a child turn, yet unchanged re-reads are measured in lane children above all, so the child is nudged to scroll up to the earlier read by a notice rather than killed',
	},
	{
		id: 'rule',
		mode_in_lane_child: 'refuse',
		because:
			'it carries the lane-only rules a child depends on (`pre-gate-cut`, `implementation-cut`, `lane-park`) and the safety rules it must still obey, and a notice was rejected despite the collateral a refusal costs a batched sibling, because a cut carried as prose was measured never to fire',
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

export type { LaneGuardMode }
export { lane_guard_policy }
