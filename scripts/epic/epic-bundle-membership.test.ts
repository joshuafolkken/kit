import { git_gh_command } from '#scripts/git/git-gh-command'
import { capped_listing_outcome, listing_outcome } from '#scripts/git/git-gh-issue-list-fixture'
import { describe, expect, it, vi } from 'vitest'
import { epic_bundle, type BacklogIssue, type BundleAction } from './epic-bundle'
import { epic_bundle_cli } from './epic-bundle-cli'
import { epic_bundle_gaps } from './epic-bundle-gaps'

// Whether the related issues' epic membership was actually read, and what the command says when it
// was not (joshuafolkken/kit#1697).
//
// Placing the subject in an epic is Tier A, so an unattended run does it without asking. Every such
// verdict asserts a negative — that no epic already tracks the subject, and for `create_epic` none of
// the candidates either — and that assertion is only as good as the epic listing it was read from. A
// listing cut short hides whole epics, so every issue they track reads as tracked by nothing; the cut
// was reported on standard error while standard output went on printing an executable instruction,
// and `fullrun.md`'s "could not answer" branch covers a warning above `Nothing to bundle.` only.
// Acted on, that produces a second epic over an already-tracked issue — the state `fullrun.md`
// forbids (joshuafolkken/kit#943).

const REPO = 'joshuafolkken/kit'
// Read through a variable key, as the command itself does. A literal one used to be rewritten to dot
// notation by `dot-notation` and then rejected by `noPropertyAccessFromIndexSignature`;
// joshuafolkken/kit#1783 switched that fix off, so matching the command is the whole reason now.
const CREATE_EPIC: BundleAction = 'create_epic'
const ADD_TO_EPIC: BundleAction = 'add_to_epic'
const CREATE_EPIC_LINE = epic_bundle_cli.ACTION_LINES[CREATE_EPIC] ?? ''
const ADD_TO_EPIC_LINE = epic_bundle_cli.ACTION_LINES[ADD_TO_EPIC] ?? ''
// The prose reference that makes the two a candidate pair — one of the only two strong signals.
const SUBJECT_BODY = 'follows #1662'

function issue(number: number, overrides: Partial<BacklogIssue> = {}): BacklogIssue {
	return { number, repo: REPO, body: '', blocked_by: [], ...overrides }
}

describe('epic_bundle_gaps.is_membership_established', () => {
	it('is established when the epic listing was read to the end', () => {
		expect(epic_bundle_gaps.is_membership_established('none')).toBe(true)
	})

	// Either cut hides whole epics, so an issue one of them tracks reads as belonging to none — which
	// is the reading `create_epic` acts on.
	it('is not established when the epic listing was cut short', () => {
		expect(epic_bundle_gaps.is_membership_established('row_limit')).toBe(false)
		expect(epic_bundle_gaps.is_membership_established('page_ceiling')).toBe(false)
	})

	// A fetched backlog records no cut when nothing capped the listing, so a caller holding that
	// optional field passes it straight through rather than coercing it (joshuafolkken/kit#1703).
	it('is established when no cut was recorded at all', () => {
		expect(epic_bundle_gaps.is_membership_established()).toBe(true)
	})
})

// The subject and one candidate, neither of which the index places in an epic — the input that
// produces `create_epic`.
const SUBJECT = issue(1696, { body: SUBJECT_BODY })
const CANDIDATE = issue(1662, { body: 'the parent' })

function rendered(is_membership_established: boolean): string {
	const decision = epic_bundle.decide_bundle(SUBJECT, [CANDIDATE])

	return epic_bundle_cli.format_decision(decision, SUBJECT, [CANDIDATE], is_membership_established)
}

describe('epic_bundle_cli.format_decision — create_epic against an epic listing that was cut short', () => {
	it('does not tell the caller to create an epic', () => {
		const output = rendered(false)

		expect(output).toContain(epic_bundle_gaps.UNCONFIRMED_MEMBERSHIP_LINE)
		expect(output).not.toContain(CREATE_EPIC_LINE)
	})

	// The children and the declared order are the recipe for the epic the line above says not to
	// create, so printing them beside the refusal hands a run the very command it must not run.
	it('withholds the children and the order', () => {
		const output = rendered(false)

		expect(output).not.toContain('Children:')
		expect(output).not.toContain('Order:')
		expect(output).toContain('Related: #1662')
	})

	it('creates the epic as before once the listing was read to the end', () => {
		const output = rendered(true)

		expect(output).toContain(CREATE_EPIC_LINE)
		expect(output).toContain('Children: #1662, #1696')
	})
})

// `add_to_epic` places the subject too, and *its* premise is that no epic already tracks the subject
// — read from the same cut index. An epic past the cut tracking the subject is invisible, so adding
// it to the one a candidate sits in is the second epic all over again (joshuafolkken/kit#943).
describe('epic_bundle_cli.format_decision — the other verdicts that place the subject', () => {
	it('withholds add_to_epic, whose premise the cut undermines just as much', () => {
		const decision = epic_bundle.decide_bundle(SUBJECT, [issue(1662, { epic: 1262 })])
		const output = epic_bundle_cli.format_decision(decision, SUBJECT, [CANDIDATE], false)

		expect(output).toContain(epic_bundle_gaps.UNCONFIRMED_MEMBERSHIP_LINE)
		expect(output).not.toContain(ADD_TO_EPIC_LINE)
	})

	it('adds to that epic as before once the listing was read to the end', () => {
		const decision = epic_bundle.decide_bundle(SUBJECT, [issue(1662, { epic: 1262 })])
		const output = epic_bundle_cli.format_decision(decision, SUBJECT, [CANDIDATE], true)

		expect(output).toContain(ADD_TO_EPIC_LINE)
		expect(output).not.toContain(epic_bundle_gaps.UNCONFIRMED_MEMBERSHIP_LINE)
	})
})

// A membership that *was* found is what survives the cut: this verdict names the epic it read
// tracking the subject, and epics past the cut cannot unseat it. Withholding it would turn a correct
// answer into a stop.
describe('epic_bundle_cli.format_decision — a verdict the cut cannot invalidate', () => {
	it('still reports the epic that already tracks the subject', () => {
		const tracked = issue(1696, { body: SUBJECT_BODY, epic: 1262 })
		const decision = epic_bundle.decide_bundle(tracked, [CANDIDATE])
		const output = epic_bundle_cli.format_decision(decision, tracked, [CANDIDATE], false)

		expect(output).toContain(epic_bundle_cli.ALREADY_TRACKED_LINE)
		expect(output).not.toContain(epic_bundle_gaps.UNCONFIRMED_MEMBERSHIP_LINE)
	})
})

describe('epic_bundle.decide_bundle — a related issue an epic already tracks', () => {
	// The acceptance criterion of joshuafolkken/kit#1697: a candidate the index does place in an epic
	// sends the answer to that epic, never to a second one. It held before this change too — the
	// reported failure was the index missing the membership, not the decision ignoring it.
	it('adds to that epic rather than creating a second one over it', () => {
		const decision = epic_bundle.decide_bundle(SUBJECT, [issue(1662, { epic: 1262 })])

		expect(decision.action).toBe('add_to_epic')
		expect(decision.epic).toBe(1262)
	})

	it('is the only difference from the create verdict the same candidates produce', () => {
		expect(epic_bundle.decide_bundle(SUBJECT, [CANDIDATE]).action).toBe('create_epic')
	})
})

const EPIC_LISTING = '[{"number":1262,"body":"- [ ] #1"}]'
const BACKLOG_LISTING =
	'[{"number":1696,"title":"a","body":"follows #1662"},{"number":1662,"title":"b","body":"the parent"}]'

// The whole command, so the cutoff is proved to reach the verdict rather than only the predicate.
async function report_with_capped_epics(): Promise<string> {
	const epics = vi
		.spyOn(git_gh_command, 'issue_list_by_label')
		.mockResolvedValue(capped_listing_outcome(EPIC_LISTING))
	const backlog = vi
		.spyOn(git_gh_command, 'issue_list_open_bodies')
		.mockResolvedValue(listing_outcome(BACKLOG_LISTING))
	const relations = vi
		.spyOn(git_gh_command, 'issue_get_state_and_relations')
		.mockResolvedValue(undefined)
	const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
	const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

	try {
		await epic_bundle_cli.report_for(1696, REPO)

		return info.mock.calls.map((call) => String(call[0])).join('\n')
	} finally {
		for (const spy of [epics, backlog, relations, info, error]) spy.mockRestore()
	}
}

describe('epic_bundle_cli.report_for — the cut reaches the verdict', () => {
	it('withholds the create instruction rather than only warning beside it', async () => {
		const printed = await report_with_capped_epics()

		expect(printed).toContain(epic_bundle_gaps.UNCONFIRMED_MEMBERSHIP_LINE)
		expect(printed).not.toContain(CREATE_EPIC_LINE)
	})
})
