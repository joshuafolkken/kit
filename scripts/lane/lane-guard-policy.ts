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
// **But a denial is not the only way a guard can speak, and that is what kit#2164 tried.** A guard can
// also raise a *notice* — a non-blocking `additionalContext` that carries the same guidance without a
// `permissionDecision`, so the turn is never ended. kit#2164 downgraded the batching guard to a notice
// in the child for exactly that reason. So the choice is three-valued, not two:
//
//   - `refuse` — deny the call (the main-line default; the child keeps this for the safety rules).
//   - `notice` — let the call through but attach the guidance, so a headless child is nudged, not killed.
//   - `off`    — say nothing at all, for a guard whose remedy the child cannot carry out.
//
// **The notice did not move the number, kit#2178 took it off, and kit#2276 restores it changed.** The
// lane child that ran right after kit#2164 merged came in at 1.00 calls per turn on both sides of the
// first notice (transcript `f39efeb5`), so kit#2178 turned the batching notice `off` in the child rather
// than pay the per-turn context cost of guidance measured not to work. But with it off, the notice fired
// **zero** times across the 2026-09-21 backlogrun the density was next measured on, so the 1.147 read
// there is the rate with no guidance at all — not a second measurement of the notice failing. kit#2276
// therefore restores it as `notice`, with the two things #2164's lacked: it names the concrete recent
// calls the run issued one-per-turn, and it recurs every single-call turn rather than every three. The
// mode stays a genuine experiment — the density is re-measured on the next backlogrun, and a notice that
// still does not move it is redesigned rather than kept.
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
		mode_in_lane_child: 'off',
		because:
			'the child is itself the delegated unit the refusal asks for — it cannot dispatch a sub-unit to read its own edit targets, and the remedy the reason names does not exist for it, so even a notice would carry guidance the child cannot act on',
	},
	{
		id: 'batching',
		mode_in_lane_child: 'notice',
		because:
			'a refusal ends a child turn so it cannot fire as one (kit#2138); kit#2164 replaced it with a notice, kit#2178 took that notice off after it did not move the density (1.00 calls per turn on both sides of it, transcript f39efeb5), and kit#2276 restores it as a notice — but a different one. #2178 turned the notice fully off, so across the 2026-09-21 backlogrun 13 runs it fired zero times and the measured 1.147 is the rate with no guidance at all, not guidance that failed. #2276 re-enables it with the two things #2164 lacked: it names the concrete recent calls the run issued one-per-turn (not just "batch more"), and it recurs every single-call turn rather than every three, so the pressure arrives as often as the mistake. The density is to be re-measured on the next backlogrun; if it still does not reach 1.40 the notice is redesigned rather than kept, per the issue',
	},
	{
		id: 'duplicate-read',
		mode_in_lane_child: 'notice',
		because:
			'a refusal ends a child turn so it cannot fire as one (kit#2138), and the unchanged re-reads the guard catches are measured in lane children above all (kit#2298 baseline: 8.0 per lane run) — so silencing it there (`off`) would neuter it exactly where the count lives. It takes `notice` instead: the child is nudged to scroll up to the earlier read rather than killed. The mode is a genuine experiment, as the batching notice is — a notice that does not reduce the duplicate reads on the next backlogrun is redesigned rather than kept',
	},
	{
		id: 'rule',
		mode_in_lane_child: 'refuse',
		because:
			"it carries the lane-only rules a child depends on (`pre-gate-cut`, `implementation-cut`, `lane-park`) and the safety rules a child must still obey (`shell-body`, `piped-verification`); a blanket suppression would disarm exactly the guards written for the child. `implementation-cut` (joshuafolkken/kit#2310) needs `refuse` for the same reason the pre-gate cut does — kit#1864 and kit#2310 both measured a cut carried as prose firing 0 times, so a notice, being prose in front of the run, would drop enforcement without a procedural replacement. The pre-gate-cut refusal does collateral a sibling call batched in the same turn — a `PreToolUse` deny cancels the turn's other parallel calls, which is the harness behavior kit#2177 measured on #2160 (gate refused, its batched `review:brief` cancelled) — and that collateral is not avoidable at the guard level. `notice` was considered for the pre-gate-cut point and rejected: kit#1864 measured the cut taken 0 times while it was carried as prose, and a notice is prose in front of the run (kit#2178 measured a lane-child notice not moving the number), so a notice would drop enforcement without a procedural replacement. kit#2177 supplies that replacement in the procedure instead — the chain orders the cut before the gate, so the cut is issued on its own (its `cut` verdict ends the turn, batching with nothing) and the gate runs in the fresh process where the carried cut keeps this guard silent; the refusal therefore stays `refuse` as insurance and the collateral is gone from the default path rather than from the guard",
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
