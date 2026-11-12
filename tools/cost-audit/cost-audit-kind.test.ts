import { run_handoff_launch } from '#scripts/run/handoff/run-handoff-launch'
import { run_ship_review } from '#scripts/run/ship/run-ship-review'
import { describe, expect, it } from 'vitest'
import { cost_audit_kind } from './cost-audit-kind'

const REVIEW_PROMPT = 'Run a /code-review of this checkout'
// joshuafolkken/kit#4863: the prompt `josh run:review` prints beside a brief file, which the brief no
// longer travels in.
const BRIEF_FILE_PROMPT = run_ship_review.round_one_opening('/briefs/brief.md')
// joshuafolkken/kit#6898: a `josh run:handoff` child opens with its keyword, and the wording an earlier
// preamble used still names the same origin.
const HANDOFF_PROMPT = run_handoff_launch.prompt_of(
	{ kind: 'workflow', keyword: 'kickoff', line: 'kickoff new', brief_file: 'b' },
	'File the CSV export.',
)
const EARLIER_HANDOFF_PROMPT =
	'kickoff new\n\nHanded over by a consultation session through `josh run:handoff`; the brief below is what was agreed there.'

describe('cost_audit_kind.kind_of — the kind is read off the opening prompt', () => {
	it.each([
		[REVIEW_PROMPT, false, 'review'],
		[REVIEW_PROMPT, true, 'review'],
		[BRIEF_FILE_PROMPT, true, 'review'],
		['Investigate how the gate works', true, 'subagent'],
		['Resuming the lane child for issue #3923', false, 'resume'],
		['backlogrun\nDriver handoff: Driver result: judge', false, 'wake'],
		// joshuafolkken/kit#5920: the `needs-human-review` section a hand-off carries names `/code-review`.
		[
			'backlogrun\nDriver handoff: Driver result: merge human-review #1\n/code-review',
			false,
			'wake',
		],
		['fullrun #3930', false, 'fullrun'],
		['backlogrun', false, 'backlogrun'],
		['kickoff #123', false, 'kickoff'],
		[HANDOFF_PROMPT, false, 'handoff'],
		[EARLIER_HANDOFF_PROMPT, false, 'handoff'],
		[`${HANDOFF_PROMPT}\nTighten the /code-review round cap.`, false, 'handoff'],
		['Why is the CPU at 100%?', false, cost_audit_kind.CONVERSATION],
		['', false, cost_audit_kind.CONVERSATION],
	])('reads %j (delegated: %s) as %s', (prompt, is_delegated, kind) => {
		expect(cost_audit_kind.kind_of(prompt, is_delegated)).toBe(kind)
	})
})
