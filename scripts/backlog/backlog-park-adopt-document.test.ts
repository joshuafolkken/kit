import { read_unwrapped } from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'

const PARK_DOC = '.claude/skills/workflow-commands/backlogrun-park.md'
const STEPS_DOC = '.claude/skills/workflow-commands/backlogrun-steps.md'
const ADOPT_COMMAND = 'pnpm josh backlog:triage --apply <N> --adopt <k> --reason <text>'

// joshuafolkken/kit#6671: a park the parent resolves by `--adopt` and a park left for a person are
// two named sections, the tiers cited from "decision-autonomy" rather than restated, and the
// triage step points at the one-call `--adopt` instead of `epic --decide` plus `run:park --clear`.
const PARK_SPLIT_REACH: ReadonlyArray<{ doc: string; marker: string }> = [
	{ doc: PARK_DOC, marker: '### A park the parent session resolves' },
	{ doc: PARK_DOC, marker: '### A park left for a person' },
	{ doc: PARK_DOC, marker: '`operating-rules.md` → "decision-autonomy"' },
	{ doc: PARK_DOC, marker: ADOPT_COMMAND },
	// `--adopt` refuses a child no epic tracks, so the park names the route that still settles it.
	{ doc: PARK_DOC, marker: 'No tracking epic → comment the decision, `run:park <N> --clear`' },
	{ doc: STEPS_DOC, marker: ADOPT_COMMAND },
	{ doc: STEPS_DOC, marker: '`backlogrun-park.md` → "A park the parent session resolves"' },
]

describe('the parent-resolved and person-kept parks are told apart', () => {
	it.each(PARK_SPLIT_REACH)('$doc states $marker', ({ doc, marker }) => {
		expect(read_unwrapped(doc)).toContain(marker)
	})

	it('cites the Tier definitions instead of restating them', () => {
		expect(read_unwrapped(PARK_DOC)).not.toContain('Tier A — reversible')
	})
})
