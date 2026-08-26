import { describe, expect, it } from 'vitest'
import { epic_bundle, type BacklogIssue, type BundleDecision } from './epic-bundle'
import { epic_bundle_cli } from './epic-bundle-cli'

// What the command prints for a decision, as distinct from what it decides.
//
// The two are separately wrong-able: `decide_bundle` can name the epic correctly while the headline
// above it still says `Nothing to bundle.`, which reads as "no action" over a line that is entirely
// actionable — add the prerequisite to *that* epic rather than creating a second one
// (joshuafolkken/kit#943). Nothing asserted the headline before, so reverting it left the suite
// green.

const REPO = 'joshuafolkken/kit'

function issue(number: number, overrides: Partial<BacklogIssue> = {}): BacklogIssue {
	return { number, repo: REPO, body: '', blocked_by: [], ...overrides }
}

function render(decision: BundleDecision, subject: BacklogIssue): string {
	return epic_bundle_cli.format_decision(decision, subject, [])
}

// Looked up through a variable key, as the command itself does: a literal key would be rewritten to
// dot notation by `dot-notation` and then rejected by `noPropertyAccessFromIndexSignature`.
function action_line(action: BundleDecision['action']): string {
	return epic_bundle_cli.ACTION_LINES[action] ?? ''
}

describe('epic_bundle_cli.format_decision — the headline', () => {
	it('tells the caller to use the epic that already tracks the issue', () => {
		const subject = issue(943, { epic: 893 })
		const rendered = render(epic_bundle.decide_bundle(subject, []), subject)

		expect(rendered).toContain(epic_bundle_cli.ALREADY_TRACKED_LINE)
		expect(rendered).toContain('#893 already tracks this issue')
	})

	// The number is the whole point of the line: `josh epic --add <E> ...` needs it.
	it('names the epic in the reason, not only that one exists', () => {
		const subject = issue(943, { epic: 893 })

		expect(render(epic_bundle.decide_bundle(subject, []), subject)).not.toContain(
			'already belongs to an epic',
		)
	})

	it('still says nothing to bundle when no epic is involved', () => {
		const subject = issue(1, { body: 'unrelated prose' })
		const rendered = render(epic_bundle.decide_bundle(subject, [issue(2)]), subject)

		expect(rendered).toContain(action_line('none'))
		expect(rendered).not.toContain(epic_bundle_cli.ALREADY_TRACKED_LINE)
	})

	it('leaves the other actions on their own headlines', () => {
		const decision: BundleDecision = {
			action: 'create_epic',
			epics: [],
			candidates: [2],
			reason: 'r',
		}

		expect(render(decision, issue(1))).toContain(action_line('create_epic'))
	})
})
