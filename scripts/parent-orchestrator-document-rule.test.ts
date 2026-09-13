import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

/*
 * joshuafolkken/kit#1934: the backlogrun/epicrun parent is an orchestrator, and two failures measured
 * on 2026-09-13 came from it acting like a child instead.
 *   1. It serialized new-lane dispatch behind a carried-over merge for 18 minutes, though the
 *      carried-over PRs and the new children had no dependency between them.
 *   2. It implemented a child released from `needs-decision` in its own context — 11 edits, a gate and
 *      two reviews — carrying ~290k-380k of context through every later watch of the run.
 * The fix is procedural, so what is pinned here is that the procedure says it. epicrun.md is the single
 * source; backlogrun.md cites it and never restates the lane commands.
 */

const EPICRUN = '.claude/skills/workflow-commands/epicrun.md'
const BACKLOGRUN = '.claude/skills/workflow-commands/backlogrun.md'

// The orchestrator principle: every child — fresh, `auto-ok` pickup, or released from
// `needs-decision` — takes a delegated unit, never the parent's own context.
const ORCHESTRATOR_MARKERS: ReadonlyArray<string> = [
	'**The parent orchestrates and never implements a child in its own context.**',
	'**whatever offers a child — the loop, a pickup, or a person clearing a label — the child is handed to a lane, never to the parent.**',
]

// Behavior 1: a carried-over merge does not serialize the next lane behind it.
const CARRIED_OVER_HEADING = '### A carried-over merge does not stand in front of the next lane'
const CARRIED_OVER_MARKERS: ReadonlyArray<string> = [
	CARRIED_OVER_HEADING,
	"**So the parent never runs a carried-over child's `followup` itself.**",
	'**The reads and the dispatches go out together, in one turn.**',
	"**Independence is the offer command's answer, never a judgement.**",
	'**A carried-over child that did not survive the cut is re-dispatched, never adopted.**',
]

// Behavior 2: a child released from the label goes back to a lane, not to the parent.
const RELEASED_CHILD_MARKERS: ReadonlyArray<string> = [
	"**The released child goes back to a lane, never into the parent's own context.**",
	'`pnpm josh lane:open <N>` then `pnpm josh lane:dispatch <N>`, exactly as a fresh child.',
]

describe(`${EPICRUN} — the parent orchestrator rules`, () => {
	const content = read_unwrapped(EPICRUN)

	it.each(ORCHESTRATOR_MARKERS)('states the orchestrator principle: %j', (marker) => {
		expect(content).toContain(marker)
	})

	it.each(CARRIED_OVER_MARKERS)('states the carried-over-merge rule: %j', (marker) => {
		expect(content).toContain(marker)
	})

	it.each(RELEASED_CHILD_MARKERS)('states the released-child re-dispatch: %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// backlogrun.md cites the rule and never restates the lane commands — its own document-rule test
// already forbids `pnpm josh lane:open` appearing there as a restatement, so the pointers are prose.
const BACKLOGRUN_POINTERS: ReadonlyArray<string> = [
	'`epicrun.md` → "The parent orchestrates and never implements a child in its own context"',
	'`epicrun.md` → "A carried-over merge does not stand in front of the next lane"',
	'`epicrun.md` → "Removing the label',
]

describe(`${BACKLOGRUN} — cites the orchestrator rule instead of restating it`, () => {
	const content = read_unwrapped(BACKLOGRUN)

	it.each(BACKLOGRUN_POINTERS)('routes %j to epicrun.md', (pointer) => {
		expect(content).toContain(pointer)
	})
})

// Single-sourced: the definition lives in epicrun.md, never copied into backlogrun.md.
describe('the orchestrator rule is defined once', () => {
	it('defines the carried-over heading in epicrun.md', () => {
		expect(read_unwrapped(EPICRUN)).toContain(CARRIED_OVER_HEADING)
	})

	it('does not copy the heading into backlogrun.md', () => {
		expect(read_unwrapped(BACKLOGRUN)).not.toContain(CARRIED_OVER_HEADING)
	})
})
