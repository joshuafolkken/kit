import { EPIC_LABEL, has_label_name } from '#scripts/issue/issue-labels'
import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'

// An epic `run:add` hands a live run is tracked as a root, as if `backlogrun #E` had named it: it
// is written to the carry record's `added` and never labelled, so the driver reads its children
// through `epic:next` on every pass and the board never draws the epic as a lane (kit#6535).

interface TrackOutcome {
	kind: 'tracked'
	issue: number
	// False when the run already tracks the root, declared or added: nothing is recorded twice.
	is_new: boolean
}

function is_epic(labels: ReadonlyArray<string>): boolean {
	return has_label_name(labels, EPIC_LABEL)
}

// The roots and issues the run still has to work through; a `done` one is outside, so `--retry`
// takes it back.
function tracked_of(carry: RunCarry): ReadonlySet<number> {
	return new Set(run_carry.remaining_of(carry))
}

function track(issue: number, tracked: ReadonlySet<number> = new Set()): TrackOutcome {
	return { kind: 'tracked', issue, is_new: !tracked.has(issue) }
}

// `issue` arrives as `#N`. The position is the root's place among the run's roots, as
// `--no-priority` sets it for any addition (`run_carry_added.ordered`).
function describe(issue: string, is_new: boolean, is_priority: boolean): string {
	if (!is_new) return `tracking ${issue} · already a root of this run`

	return `tracking ${issue} · epic root, ${is_priority ? 'ahead of the queue' : 'end of the queue'}`
}

// The `add` event's text: what the parent reads off the stream when the add wakes it.
function event_text(issue: string): string {
	return `added ${issue} · tracked as an epic root`
}

const run_add_epic = { describe, event_text, is_epic, track, tracked_of }

export type { TrackOutcome }
export { run_add_epic }
