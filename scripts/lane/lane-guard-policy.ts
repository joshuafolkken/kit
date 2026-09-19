import { lane_child_marker, type MarkerSource } from './lane-child-marker'

// Which `PreToolUse` guards fire in a dispatched lane child, as an enumeration rather than a judgement
// (joshuafolkken/kit#2138).
//
// **The three guards were built for the interactive main line, where a refusal is guidance.** A denial
// rewrites the next move of a person's session. A dispatched lane child is a headless `claude -p`
// process, so a denial ends the conversation with nothing committed — joshuafolkken/kit#2138 measured a
// child killed before its commit by two investigation refusals and one batching refusal, every one of
// them a read of a file the child was about to edit. So a guard whose whole premise is "the main line
// reshapes its work after the refusal" must not fire in a child.
//
// **It is an enumeration and not a judgement, for the reason `delegation-policy.ts` is one.** "This
// guard is safe to keep in a child" is a judgement made under the same pressure that produced the
// misfire. The list is the whole of it, and a guard nobody classified fires — the safe direction, since
// a wrongly-suppressed rule ships silently while a wrongly-kept one costs at most the one round trip the
// child already survived once. `lane-guard-policy.test.ts` pins that the enumeration and the guards'
// live behavior cannot disagree.

type LaneGuardId = 'investigation' | 'batching' | 'rule'

interface LaneGuardEntry {
	id: LaneGuardId
	// Whether this guard fires when the session is a dispatched lane child.
	fires_in_lane_child: boolean
	// Why. A `false` with no reason is a suppression nobody can check; a `true` names what the child
	// still needs the guard for.
	because: string
}

const LANE_GUARD_POLICY: ReadonlyArray<LaneGuardEntry> = [
	{
		id: 'investigation',
		fires_in_lane_child: false,
		because:
			'the child is itself the delegated unit the refusal asks for — it cannot dispatch a sub-unit to read its own edit targets, and the remedy the reason names does not exist for it, the same exemption a subagent transcript already gets in `should_block`',
	},
	{
		id: 'batching',
		fires_in_lane_child: false,
		because:
			'the reissue-in-one-turn correction presumes a main line that reshapes its next turn; a child doing dependent single reads of the files it is about to edit is not batching wrongly, and the refusal ends its turn instead of guiding it',
	},
	{
		id: 'rule',
		fires_in_lane_child: true,
		because:
			'it carries the lane-only rules a child depends on (`pre-gate-cut`, `lane-park`) and the safety rules a child must still obey (`shell-body`, `piped-verification`); a blanket suppression would disarm exactly the guards written for the child',
	},
]

const KNOWN_GUARD_IDS: ReadonlyArray<LaneGuardId> = LANE_GUARD_POLICY.map((entry) => entry.id)

function entry_for(id: string): LaneGuardEntry | undefined {
	return LANE_GUARD_POLICY.find((entry) => entry.id === id.trim())
}

// **An unenumerated guard fires**, the same fail-safe direction `delegation-policy.ts` takes: a guard
// nobody listed is kept rather than silently suppressed, because a suppression is what ships a missed
// rule.
function fires_in_lane_child(id: string): boolean {
	return entry_for(id)?.fires_in_lane_child ?? true
}

// True when this guard must stand down because the session is a dispatched lane child. The call-shape or
// command test the caller already made comes first, so `is_child_of` — the dispatch mark against this
// checkout's own issue — is read only where a guard would otherwise fire, never on every call.
function is_suppressed_here(
	id: string,
	directory: string = process.cwd(),
	source: MarkerSource = process.env,
): boolean {
	if (fires_in_lane_child(id)) return false

	return lane_child_marker.is_child_of(directory, source)
}

const lane_guard_policy = {
	LANE_GUARD_POLICY,
	KNOWN_GUARD_IDS,
	entry_for,
	fires_in_lane_child,
	is_suppressed_here,
}

export type { LaneGuardEntry, LaneGuardId }
export { lane_guard_policy }
