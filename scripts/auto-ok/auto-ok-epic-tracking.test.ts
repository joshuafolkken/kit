import { listing_outcome } from '#scripts/git/git-gh-issue-list-fixture'
import { AUTO_OK_LABEL } from '#scripts/git/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { auto_ok_cli } from './auto-ok-cli'
import {
	auto_ok_fixture,
	BLOCKER_NUMBER,
	CREATED_LATER,
	EPIC_NUMBER,
	FAILURE_EXIT_CODE,
	NEW_ISSUE_NUMBER,
	OLD_ISSUE_NUMBER,
	SUCCESS_EXIT_CODE,
} from './auto-ok-fixture'

// joshuafolkken/kit#1633: the candidate set was decided by comparing labels, and an epic's child
// carries none of the three that set names — so `auto-ok` on a child put it in the standalone
// candidate set, where the epic's own `blocked-by` ordering is never read. Its own suite because the
// pickup file is at its line budget and this is a second question: `auto-ok-pickup.test.ts` asks
// whether a candidate is ready to run, this one asks whether it is this path's to hand back at all.

vi.mock('#scripts/git/git-gh-command', () => ({
	git_gh_command: { issue_list_by_label_summary: vi.fn(), issue_list_by_label: vi.fn() },
}))

const { git_gh_command } = await import('#scripts/git/git-gh-command')
const issue_list = vi.mocked(git_gh_command.issue_list_by_label_summary)
// The second listing: the open epics, whose task lists say which issues are already tracked.
const epic_list = vi.mocked(git_gh_command.issue_list_by_label)
const { issue, epic_listing, console_streams, two_issues } = auto_ok_fixture

const streams = console_streams()
const { stdout, stderr } = streams

vi.spyOn(console, 'info').mockImplementation(streams.info)
vi.spyOn(console, 'error').mockImplementation(streams.error)

function tracking(children: ReadonlyArray<number>): ReturnType<typeof listing_outcome> {
	return listing_outcome(epic_listing([{ number: EPIC_NUMBER, children }]))
}

// An epic listing exactly at the cap, so the gap notice fires.
function capped_epic_listing(): ReturnType<typeof listing_outcome> {
	return listing_outcome(
		epic_listing(
			Array.from({ length: auto_ok_cli.LISTING_LIMIT }, (_value, index) => ({
				number: index + 1,
				children: [],
			})),
		),
	)
}

beforeEach(() => {
	vi.clearAllMocks()
	issue_list.mockResolvedValue(listing_outcome(undefined))
	epic_list.mockResolvedValue(listing_outcome(epic_listing([])))
	streams.reset()
})

describe('josh auto-ok:next — an issue an epic already tracks', () => {
	it('does not answer a child of an open epic', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome(two_issues()))
		epic_list.mockResolvedValueOnce(tracking([NEW_ISSUE_NUMBER]))

		expect(await auto_ok_cli.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(OLD_ISSUE_NUMBER))
	})

	it('answers `none` when every opted-in issue is tracked', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome(two_issues()))
		epic_list.mockResolvedValueOnce(tracking([NEW_ISSUE_NUMBER, OLD_ISSUE_NUMBER]))

		expect(await auto_ok_cli.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(auto_ok_cli.NONE_TOKEN)
	})

	// The other half of the acceptance: an issue no epic tracks behaves exactly as it did.
	it('still answers an issue no epic tracks', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome(two_issues()))
		epic_list.mockResolvedValueOnce(tracking([BLOCKER_NUMBER]))

		expect(await auto_ok_cli.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(NEW_ISSUE_NUMBER))
	})

	// The exclusion is membership, not a label: the child carries `auto-ok` and nothing else, which is
	// exactly the row `NOT_DIRECTLY_RUNNABLE_LABELS` cannot see.
	it('excludes a child the label comparison would have handed back', async () => {
		const opted_in_only = [issue(NEW_ISSUE_NUMBER, CREATED_LATER, [AUTO_OK_LABEL])]

		issue_list.mockResolvedValueOnce(listing_outcome(JSON.stringify(opted_in_only)))
		epic_list.mockResolvedValueOnce(tracking([NEW_ISSUE_NUMBER]))

		expect(await auto_ok_cli.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(auto_ok_cli.NONE_TOKEN)
	})
})

// Reading a failed epic listing as "no epic tracks anything" turns every tracked child back into a
// standalone candidate — the same confident absence joshuafolkken/kit#950 is about, in a new place.
describe('josh auto-ok:next — the epic listing could not be read', () => {
	it.each([
		['gh itself failed', undefined],
		['gh answered something that is not a listing', '{"message":"API rate limit exceeded"}'],
		// A schema mismatch is rethrown by the parser rather than answered `undefined`, so without a
		// catch this command dies with a stack trace and an empty standard output — which a pickup loop
		// reading `answer=$(…)` cannot tell from `none`.
		['the epic rows came back in an unexpected shape', '[{"unexpected":true}]'],
	])('refuses to answer when %s', async (_case, raw) => {
		issue_list.mockResolvedValueOnce(listing_outcome(two_issues()))
		epic_list.mockResolvedValueOnce(listing_outcome(raw))

		expect(await auto_ok_cli.run([])).toBe(FAILURE_EXIT_CODE)
		expect(stdout()).toBe('')
		expect(stderr()).toContain(auto_ok_cli.EPICS_UNREADABLE_MESSAGE)
	})

	// Nothing opted in means no candidate an epic could be tracking, so the listing is never paid for.
	it('does not read the epics when nothing is opted in', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome('[]'))

		expect(await auto_ok_cli.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(epic_list).not.toHaveBeenCalled()
	})

	// A cut-short epic listing hides an epic, so a child of it reads as standalone — said rather than
	// answered over.
	it('warns when the epic listing was cut short', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome(two_issues()))
		epic_list.mockResolvedValueOnce(capped_epic_listing())
		await auto_ok_cli.run([])

		expect(stderr()).toContain('The epic listing')
	})
})
