import { epic_bundle_gaps } from '#scripts/epic/epic-bundle-gaps'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { listing_of, listing_outcome } from '#scripts/git/git-gh-issue-list-fixture'
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

// The two listings the command reads, plus the repository name. Every case supplies its own backlog;
// the epic listing defaults to the one epic that tracks #1246.
function stub_reads(
	backlog: ReadonlyArray<ListingRow>,
	epics: ReadonlyArray<unknown> = [EPIC_ROW],
	is_epic_listing_capped = false,
): void {
	vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(REPO)
	vi.spyOn(git_gh_command, 'issue_list_by_label').mockResolvedValue(
		listing_of(epics, is_epic_listing_capped),
	)
	vi.spyOn(git_gh_command, 'issue_list_open_bodies').mockResolvedValue(listing_of(backlog))
}

// Standard error is silenced rather than asserted: a capped listing warns there, and which warnings
// the command emits is `epic-bundle-cli`'s own subject. What this file reads is standard output.
async function printed(
	argv: ReadonlyArray<string>,
	backlog: ReadonlyArray<ListingRow>,
	epics: ReadonlyArray<unknown> = [EPIC_ROW],
	is_epic_listing_capped = false,
): Promise<string> {
	stub_reads(backlog, epics, is_epic_listing_capped)

	const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

	vi.spyOn(console, 'error').mockImplementation(() => undefined)

	await issue_scout_cli.run(argv)

	return info.mock.calls.map((call) => String(call[0])).join('\n')
}

// The same run with the epic listing reported as cut short — the only variable the cases below turn.
async function printed_with_cut(
	argv: ReadonlyArray<string>,
	backlog: ReadonlyArray<ListingRow>,
): Promise<string> {
	return await printed(argv, backlog, [EPIC_ROW], true)
}

// The draft that reaches a placing verdict: it cites an open issue, and one epic already tracks that
// issue. Reused by every case below so only the cut varies between them.
const CITING_DRAFT = [DRAFT_TITLE, '--body', `follows on from #${String(RELATED_NUMBER)}`]
const CITED_BACKLOG = [row(RELATED_NUMBER, 'Print each verification-gate check elapsed time')]
const MISSING_DRAFT = [DRAFT_TITLE, '--body', `follows on from #${String(MISSING_NUMBER)}`]
const NAMED_EPIC_DRAFT = [DRAFT_TITLE, '--body', `part of epic #${String(EPIC_NUMBER)}`]
const NAMED_EPIC_BACKLOG = [row(EPIC_NUMBER, 'Epic: make a run answer before it files')]
const UNRELATED_BACKLOG = [row(UNRELATED_NUMBER, UNRELATED_TITLE)]

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
		const output = await printed([DRAFT_TITLE], UNRELATED_BACKLOG)

		expect(output).toContain(issue_scout_cli.NO_DUPLICATE_LINE)
	})
})

describe('issue_scout_cli.run — where it belongs', () => {
	it('names the epic that already tracks an issue the draft cites', async () => {
		const output = await printed(CITING_DRAFT, CITED_BACKLOG)

		expect(output).toContain(`Target epic: #${String(EPIC_NUMBER)}`)
		expect(output).toContain(`Related: #${String(RELATED_NUMBER)}`)
	})

	it('says to file it standalone when nothing open shares a reference', async () => {
		// The cited number is not in the listing, so it is read on its own — stubbed as a number that
		// resolves to nothing, which is an answer rather than a gap (joshuafolkken/kit#957).
		vi.spyOn(git_gh_command, 'issue_get_plan_fields_classified').mockResolvedValue({
			kind: 'missing',
		})

		const output = await printed(MISSING_DRAFT, UNRELATED_BACKLOG)

		expect(output).toContain(issue_scout_cli.NO_EPIC_LINE)
	})
})

// joshuafolkken/kit#1697 withheld `epic:bundle`'s placing verdicts when the epic listing was cut
// short; this command drew the same verdicts from its own formatter and so never reached that gate
// (joshuafolkken/kit#1703). An epic past the cut tracks its children invisibly, so each of them reads
// as tracked by nothing — and this command runs before every filing, so the reading is acted on more
// often here than in the command it borrows from.
describe('issue_scout_cli.run — the epic listing was cut short', () => {
	it('withholds the placement rather than naming a target epic', async () => {
		const output = await printed_with_cut(CITING_DRAFT, CITED_BACKLOG)

		expect(output).toContain(`Epic: ${epic_bundle_gaps.UNCONFIRMED_MEMBERSHIP_LINE}`)
		expect(output).not.toContain(`Target epic: #${String(EPIC_NUMBER)}`)
	})

	// The candidates were read; only which epics they sit in was not. Dropping them would withhold an
	// answer the command does have.
	it('still names the candidates it did read', async () => {
		const output = await printed_with_cut(CITING_DRAFT, CITED_BACKLOG)

		expect(output).toContain(`Related: #${String(RELATED_NUMBER)}`)
	})
})

// What a cut cannot reach: an answer that places nothing has no candidate for a hidden epic to
// already track, and an epic the run actually read is a membership found rather than one inferred.
describe('issue_scout_cli.run — answers a cut epic listing leaves alone', () => {
	it('still says the epic half was not asked when the summary cites nothing', async () => {
		const output = await printed_with_cut([DRAFT_TITLE], UNRELATED_BACKLOG)

		expect(output).toContain(issue_scout_cli.NO_REFERENCE_LINE)
		expect(output).not.toContain(epic_bundle_gaps.UNCONFIRMED_MEMBERSHIP_LINE)
	})

	it('still says to file it standalone when nothing open shares a reference', async () => {
		vi.spyOn(git_gh_command, 'issue_get_plan_fields_classified').mockResolvedValue({
			kind: 'missing',
		})

		const output = await printed_with_cut(MISSING_DRAFT, UNRELATED_BACKLOG)

		expect(output).toContain(issue_scout_cli.NO_EPIC_LINE)
		expect(output).not.toContain(epic_bundle_gaps.UNCONFIRMED_MEMBERSHIP_LINE)
	})

	it('still names the epic the summary itself points at', async () => {
		const output = await printed_with_cut(NAMED_EPIC_DRAFT, NAMED_EPIC_BACKLOG)

		expect(output).toContain(`names #${String(EPIC_NUMBER)}`)
		expect(output).not.toContain(epic_bundle_gaps.UNCONFIRMED_MEMBERSHIP_LINE)
	})
})

// With no number in the summary the epic half has nothing to decide from — its signals are prose
// references and recorded dependencies, and a title carries neither. "File it standalone" there
// reports a scan that found nothing where none was possible.
describe('issue_scout_cli.run — a draft that cites nothing', () => {
	it('says the epic half was not asked when the summary cites nothing', async () => {
		const output = await printed([DRAFT_TITLE], UNRELATED_BACKLOG)

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
		const output = await printed(NAMED_EPIC_DRAFT, NAMED_EPIC_BACKLOG)

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

		await printed([DRAFT_TITLE], UNRELATED_BACKLOG)

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
		stub_reads(UNRELATED_BACKLOG)

		expect(await issue_scout_cli.run([DRAFT_TITLE])).toBe(SUCCESS_EXIT_CODE)
	})
})
