import { describe, expect, it, vi } from 'vitest'
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
const BODY_WITH_REFERENCE = 'refers to #891'

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

// joshuafolkken/kit#947: the referenced-issue read is the second half of the fix, and its failure
// mode is the one the whole Issue is about — a read that did not happen must not arrive as "no
// relation found". `warn_about_gaps` is what keeps it visible, so the wiring is asserted here rather
// than left to the pure layer, which never sees the console.
function captured(backlog: Parameters<typeof epic_bundle_cli.warn_about_gaps>[0]): string {
	const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

	try {
		epic_bundle_cli.warn_about_gaps(backlog)

		return spy.mock.calls.map((call) => String(call[0])).join('\n')
	} finally {
		spy.mockRestore()
	}
}

describe('epic_bundle_cli.warn_about_gaps — a read that did not happen', () => {
	it('names the issues it could not read', () => {
		const warned = captured({ issues: [], unreadable: [891], is_readable: true })

		expect(warned).toContain('#891')
	})

	// The wording covered relation reads only, which was accurate while that was the sole extra read.
	// A referenced issue is now read whole, and a warning naming "relations" would send the reader
	// looking for a dependency that was never the thing that failed.
	it('does not claim it was only the relations that failed', () => {
		expect(captured({ issues: [], unreadable: [891], is_readable: true })).not.toContain(
			'relations for',
		)
	})

	it('says nothing when every read succeeded', () => {
		expect(captured({ issues: [], unreadable: [], is_readable: true })).toBe('')
	})
})

// The widening is skipped, not crashed, when the epic view is absent — the branch a failed epic
// listing takes, where the command already exits non-zero with its own message.
describe('epic_bundle_cli.widen_with_referenced', () => {
	it('returns the backlog untouched without an epic view', async () => {
		const backlog = { issues: [], unreadable: [], is_readable: true }
		const subject = issue(943, { body: BODY_WITH_REFERENCE })

		expect(await epic_bundle_cli.widen_with_referenced(subject, backlog)).toBe(backlog)
	})

	// No references means no requests: the common case must not pay a round trip to learn that.
	it('makes no request when the body names nothing new', async () => {
		const backlog = {
			issues: [issue(943)],
			unreadable: [],
			is_readable: true,
			context: { repo: REPO, epics: new Map(), epic_numbers: new Set<number>() },
		}
		const subject = issue(943, { body: 'no references here' })

		expect(await epic_bundle_cli.widen_with_referenced(subject, backlog)).toBe(backlog)
	})
})

// An issue an epic already tracks short-circuits in `decide_bundle`, so widening for it is a request
// per reference spent on a verdict that ignores them — and a failed one prints a gap warning above
// an answer the read was never part of (joshuafolkken/kit#947, second review).
describe('epic_bundle_cli.widen_with_referenced — an issue that already has an epic', () => {
	it('does not read the references of an issue an epic already tracks', async () => {
		const backlog = {
			issues: [],
			unreadable: [],
			is_readable: true,
			context: { repo: REPO, epics: new Map(), epic_numbers: new Set<number>() },
		}
		const subject = issue(943, { body: BODY_WITH_REFERENCE, epic: 893 })

		expect(await epic_bundle_cli.widen_with_referenced(subject, backlog)).toBe(backlog)
	})
})
