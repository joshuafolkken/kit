import { git_gh_command } from '#scripts/git/git-gh-command'
import {
	capped_listing_outcome,
	listing_of,
	listing_outcome,
} from '#scripts/git/git-gh-issue-list-fixture'
import { EPIC_LABEL } from '#scripts/git/issue-labels'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { issue_scout_cli } from './issue-scout-cli'

// What the command answers before an issue is filed, as distinct from what it decides.
//
// The epic half is `epic:bundle`'s decision called rather than restated, so what is asserted here is
// the reading a draft needs: a subject with no number, no relations of its own, and `none` meaning
// "file it standalone" rather than `epic:bundle`'s "an epic already tracks it"
// (joshuafolkken/kit#1252).

const REPO = 'joshuafolkken/kit'
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const DRAFT_TITLE = 'Answer whether a new Issue already exists and which epic it belongs to'
const NEAR_DUPLICATE_TITLE = 'Answer whether a new Issue already exists before filing it'
const UNRELATED_TITLE = 'Stop a stalled push hanging josh git with no timeout or keepalive'
const NEAR_DUPLICATE_NUMBER = 1249
const UNRELATED_NUMBER = 1251
const RELATED_NUMBER = 1246
const MISSING_NUMBER = 999_999
const EPIC_NUMBER = 1153

interface ListingRow {
	number: number
	title: string
	body: string
}

function row(number: number, title: string, body = ''): ListingRow {
	return { number, title, body }
}

const EPIC_ROW = { number: EPIC_NUMBER, body: `- [ ] #${String(RELATED_NUMBER)}` }

// The three listings the command reads, plus the repository name. Every case supplies its own
// backlog; the epic listing defaults to the one epic that tracks #1246, and the recently-closed
// listing to empty — the answer every case written before joshuafolkken/kit#1679 assumed.
function stub_reads(
	backlog: ReadonlyArray<ListingRow>,
	epics: ReadonlyArray<unknown> = [EPIC_ROW],
	closed: ReadonlyArray<unknown> = [],
): void {
	vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(REPO)
	vi.spyOn(git_gh_command, 'issue_list_by_label').mockResolvedValue(listing_of(epics))
	vi.spyOn(git_gh_command, 'issue_list_open_bodies').mockResolvedValue(listing_of(backlog))
	vi.spyOn(git_gh_command, 'issue_list_recently_closed').mockResolvedValue(listing_of(closed))
}

async function printed(
	argv: ReadonlyArray<string>,
	backlog: ReadonlyArray<ListingRow>,
	epics: ReadonlyArray<unknown> = [EPIC_ROW],
	closed: ReadonlyArray<unknown> = [],
): Promise<string> {
	stub_reads(backlog, epics, closed)

	const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

	await issue_scout_cli.run(argv)

	return info.mock.calls.map((call) => String(call[0])).join('\n')
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('issue_scout_cli.run — a duplicate is already open', () => {
	it('names the open issue whose title restates the draft', async () => {
		const output = await printed(
			[DRAFT_TITLE],
			[row(UNRELATED_NUMBER, UNRELATED_TITLE), row(NEAR_DUPLICATE_NUMBER, NEAR_DUPLICATE_TITLE)],
		)

		expect(output).toContain(`#${String(NEAR_DUPLICATE_NUMBER)}`)
		expect(output).toContain(NEAR_DUPLICATE_TITLE)
	})

	it('does not name an issue that merely shares a subsystem', async () => {
		const output = await printed([DRAFT_TITLE], [row(UNRELATED_NUMBER, UNRELATED_TITLE)])

		expect(output).toContain(issue_scout_cli.NO_DUPLICATE_LINE)
	})
})

// joshuafolkken/kit#1679: the work most likely to be filed twice is the work that just finished, and
// a scan reading open issues only cannot see any of it — joshuafolkken/kit#1656 was filed about five
// hours after the issue that had already done it closed.
describe('issue_scout_cli.run — a duplicate that has already closed', () => {
	it('names a recently closed issue whose title restates the draft', async () => {
		const output = await printed(
			[DRAFT_TITLE],
			[row(UNRELATED_NUMBER, UNRELATED_TITLE)],
			[EPIC_ROW],
			[row(NEAR_DUPLICATE_NUMBER, NEAR_DUPLICATE_TITLE)],
		)

		expect(output).toContain(`#${String(NEAR_DUPLICATE_NUMBER)}`)
	})

	// An open candidate says somebody is already tracking this; a closed one says it may already be
	// done, and the two send the reader down different exits.
	it('says which candidates are closed', async () => {
		const output = await printed(
			[DRAFT_TITLE],
			[],
			[EPIC_ROW],
			[row(NEAR_DUPLICATE_NUMBER, NEAR_DUPLICATE_TITLE)],
		)

		expect(output).toContain('(closed)')
	})
})

describe('issue_scout_cli.run — the closed listing has its own limits', () => {
	// `decide_bundle` places a draft among issues still being worked on. A closed one can neither gain
	// a sibling nor be recommended as an epic, so widening the placement pool with the closed rows
	// would answer a different question from the one it was asked.
	it('keeps the closed rows out of the epic half', async () => {
		// The cited number is not in the *open* listing, so it is read on its own — stubbed as a number
		// that resolves to nothing, exactly as the standalone case above does.
		vi.spyOn(git_gh_command, 'issue_get_plan_fields_classified').mockResolvedValue({
			kind: 'missing',
		})

		const output = await printed(
			[DRAFT_TITLE, '--body', `follows on from #${String(RELATED_NUMBER)}`],
			[],
			[EPIC_ROW],
			[row(RELATED_NUMBER, NEAR_DUPLICATE_TITLE)],
		)

		expect(output).toContain(issue_scout_cli.NO_EPIC_LINE)
	})
})

describe('issue_scout_cli.run — what the closed half will not report', () => {
	// A closed epic is still a container. `epic_bundle_cli` marks the open rows from the *open* epic
	// listing, which by construction holds none — so the closed half reads the label itself. Reported
	// as a duplicate it says "this work is already done" about an epic that never had an
	// implementation of its own, and the run takes the already-done exit instead of filing.
	it('never offers a closed epic as a duplicate', async () => {
		const output = await printed(
			[DRAFT_TITLE],
			[],
			[EPIC_ROW],
			[
				{
					number: NEAR_DUPLICATE_NUMBER,
					title: NEAR_DUPLICATE_TITLE,
					labels: [{ name: EPIC_LABEL }],
				},
			],
		)

		expect(output).toContain(issue_scout_cli.NO_DUPLICATE_LINE)
	})
})

describe('issue_scout_cli.run — what the closed half says about its own gaps', () => {
	// The page ceiling is not the `limit`: pull requests are filtered out client-side, so a repository
	// whose recent closures are mostly merged pull requests can select fewer than the window while the
	// listing still has more to give — and the scan then covers less than it was asked for.
	it('says so when the page ceiling cut the closed listing short', async () => {
		stub_reads([row(UNRELATED_NUMBER, UNRELATED_TITLE)])
		vi.spyOn(git_gh_command, 'issue_list_recently_closed').mockResolvedValue(
			capped_listing_outcome('[]'),
		)
		vi.spyOn(console, 'info').mockImplementation(() => undefined)

		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await issue_scout_cli.run([DRAFT_TITLE])).toBe(SUCCESS_EXIT_CODE)
		expect(error.mock.calls.join('\n')).toContain(issue_scout_cli.CLOSED_CEILING_LINE)
	})

	// The ordinary run says nothing: a warning printed every time is one nobody reads, and it would
	// train the reader past the gap lines beside it that do carry signal.
	it('says nothing about the closed listing on an ordinary run', async () => {
		stub_reads([row(UNRELATED_NUMBER, UNRELATED_TITLE)])
		vi.spyOn(console, 'info').mockImplementation(() => undefined)

		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		await issue_scout_cli.run([DRAFT_TITLE])

		expect(error.mock.calls.join('\n')).not.toContain('recently closed')
	})

	// The open half ran, so this is a gap in the answer rather than a failure of it — and a run told
	// nothing would file the duplicate the scan exists to catch.
	it('warns rather than failing when the closed listing could not be read', async () => {
		stub_reads([row(UNRELATED_NUMBER, UNRELATED_TITLE)])
		vi.spyOn(git_gh_command, 'issue_list_recently_closed').mockResolvedValue(
			listing_outcome(undefined),
		)
		vi.spyOn(console, 'info').mockImplementation(() => undefined)

		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await issue_scout_cli.run([DRAFT_TITLE])).toBe(SUCCESS_EXIT_CODE)
		expect(error.mock.calls.join('\n')).toContain(issue_scout_cli.CLOSED_UNREADABLE_LINE)
	})
})

describe('issue_scout_cli.run — where it belongs', () => {
	it('names the epic that already tracks an issue the draft cites', async () => {
		const output = await printed(
			[DRAFT_TITLE, '--body', `follows on from #${String(RELATED_NUMBER)}`],
			[row(RELATED_NUMBER, 'Print each verification-gate check elapsed time')],
		)

		expect(output).toContain(`Target epic: #${String(EPIC_NUMBER)}`)
		expect(output).toContain(`Related: #${String(RELATED_NUMBER)}`)
	})

	it('says to file it standalone when nothing open shares a reference', async () => {
		// The cited number is not in the listing, so it is read on its own — stubbed as a number that
		// resolves to nothing, which is an answer rather than a gap (joshuafolkken/kit#957).
		vi.spyOn(git_gh_command, 'issue_get_plan_fields_classified').mockResolvedValue({
			kind: 'missing',
		})

		const output = await printed(
			[DRAFT_TITLE, '--body', `follows on from #${String(MISSING_NUMBER)}`],
			[row(UNRELATED_NUMBER, UNRELATED_TITLE)],
		)

		expect(output).toContain(issue_scout_cli.NO_EPIC_LINE)
	})
})

// With no number in the summary the epic half has nothing to decide from — its signals are prose
// references and recorded dependencies, and a title carries neither. "File it standalone" there
// reports a scan that found nothing where none was possible.
describe('issue_scout_cli.run — a draft that cites nothing', () => {
	it('says the epic half was not asked when the summary cites nothing', async () => {
		const output = await printed([DRAFT_TITLE], [row(UNRELATED_NUMBER, UNRELATED_TITLE)])

		expect(output).toContain(issue_scout_cli.NO_REFERENCE_LINE)
		expect(output).not.toContain(issue_scout_cli.NO_EPIC_LINE)
	})

	// The placement answer for a title-only draft: the epic half cannot give one, so the epic each
	// duplicate belongs to is printed beside it.
	it('names the epic tracking a duplicate candidate', async () => {
		const output = await printed(
			[DRAFT_TITLE],
			[row(RELATED_NUMBER, NEAR_DUPLICATE_TITLE)],
			[{ number: EPIC_NUMBER, body: `- [ ] #${String(RELATED_NUMBER)}` }],
		)

		expect(output).toContain(`(epic #${String(EPIC_NUMBER)})`)
	})

	// An epic is excluded from the candidate pool — a container is not a sibling — so a draft naming
	// one reaches `none`. Printed as "file it standalone", the epic the person named is lost.
	it('names the epic the summary itself points at', async () => {
		const output = await printed(
			[DRAFT_TITLE, '--body', `part of epic #${String(EPIC_NUMBER)}`],
			[row(EPIC_NUMBER, 'Epic: make a run answer before it files')],
		)

		expect(output).toContain(`names #${String(EPIC_NUMBER)}`)
		expect(output).not.toContain(issue_scout_cli.NO_EPIC_LINE)
	})

	it('answers both halves in one run', async () => {
		const output = await printed(
			[DRAFT_TITLE, '--body', `follows on from #${String(RELATED_NUMBER)}`],
			[row(RELATED_NUMBER, NEAR_DUPLICATE_TITLE)],
		)

		expect(output).toContain('Duplicates:')
		expect(output).toContain('Epic:')
	})
})

// A draft has no number, so no recorded dependency can name it and it declares none of its own. The
// reads cannot change either half of the answer, and one per open issue is what the command exists to
// stop spending.
describe('issue_scout_cli.run — what it does not read', () => {
	it('reads no blocked-by relations', async () => {
		const relations = vi
			.spyOn(git_gh_command, 'issue_get_state_and_relations')
			.mockResolvedValue(undefined)

		await printed([DRAFT_TITLE], [row(UNRELATED_NUMBER, UNRELATED_TITLE)])

		expect(relations).not.toHaveBeenCalled()
	})
})

describe('issue_scout_cli.run — what it refuses', () => {
	it('prints the usage line when no title is given', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await issue_scout_cli.run([])).toBe(FAILURE_EXIT_CODE)
		expect(error.mock.calls.join('\n')).toContain(issue_scout_cli.USAGE)
	})

	it('refuses an unknown flag rather than ignoring it', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await issue_scout_cli.run([DRAFT_TITLE, '--nope'])).toBe(FAILURE_EXIT_CODE)
		expect(error.mock.calls.join('\n')).toContain(issue_scout_cli.USAGE)
	})

	it('refuses a repository it could not read', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(undefined)

		expect(await issue_scout_cli.run([DRAFT_TITLE])).toBe(FAILURE_EXIT_CODE)
		expect(error.mock.calls.join('\n')).toContain(issue_scout_cli.UNKNOWN_REPO_MESSAGE)
	})

	// A listing that failed is not an empty backlog: read as one, the command answers "nothing like
	// this exists" on data that never arrived — on the command a run consults before every filing.
	it('refuses a backlog listing that failed', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(REPO)
		vi.spyOn(git_gh_command, 'issue_list_by_label').mockResolvedValue(listing_of([EPIC_ROW]))
		vi.spyOn(git_gh_command, 'issue_list_open_bodies').mockResolvedValue(listing_outcome(undefined))

		expect(await issue_scout_cli.run([DRAFT_TITLE])).toBe(FAILURE_EXIT_CODE)
		expect(error.mock.calls.join('\n')).toContain('no recommendation was made')
	})

	it('answers successfully when the backlog is readable', async () => {
		stub_reads([row(UNRELATED_NUMBER, UNRELATED_TITLE)])

		expect(await issue_scout_cli.run([DRAFT_TITLE])).toBe(SUCCESS_EXIT_CODE)
	})
})
