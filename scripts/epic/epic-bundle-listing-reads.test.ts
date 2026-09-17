import { git_gh_command } from '#scripts/git/git-gh-command'
import { listing_of } from '#scripts/git/git-gh-issue-list-fixture'
import { describe, expect, it, vi, type MockInstance } from 'vitest'
import { epic_bundle_cli } from './epic-bundle-cli'

// joshuafolkken/kit#1736: the open-issue listing `epic:bundle` already holds carries GitHub's own
// `issue_dependencies_summary`, so an issue with no blockers can be answered from it instead of
// costing a request of its own. Before this the command read every open issue individually, which
// made it heavier exactly as a growing backlog made it more useful.
//
// **What these cases pin is the direction of the skip.** Skipping wrongly loses a relation in
// silence — a bundle that should have been proposed is reported as "no strong signal" — while
// reading unnecessarily costs one request. So a count of exactly zero is the only thing that skips,
// and every other answer, an absent summary included, keeps the read.

const REPO = 'joshuafolkken/kit'
const SUBJECT = 10
const RELATED = 11
const OTHER_RELATED = 12
const EPIC = 100
const OTHER_EPIC = 101
const NO_BLOCKERS = 0
const ONE_BLOCKER = 1

interface Row {
	number: number
	body?: string
	blocked_by_count?: number | null
}

interface Reads {
	backlog: Awaited<ReturnType<typeof epic_bundle_cli.fetch_backlog>>
	relations: MockInstance<typeof git_gh_command.issue_get_state_and_relations>
}

function listing_row(row: Row): Record<string, unknown> {
	return { title: '', body: '', ...row }
}

// The backlog listing and the per-issue relation read, both mocked, with the relation spy handed
// back so a case can assert on what it was *not* asked. The read resolves `undefined`, which the
// command reads as "this one could not be read" — the answer that separates a skipped row from a
// failed one.
async function fetch_with(rows: ReadonlyArray<Row>): Promise<Reads> {
	vi.spyOn(git_gh_command, 'issue_list_open_bodies').mockResolvedValue(
		listing_of(rows.map((row) => listing_row(row))),
	)
	const relations = vi
		.spyOn(git_gh_command, 'issue_get_state_and_relations')
		.mockResolvedValue(undefined)

	return { backlog: await epic_bundle_cli.fetch_backlog(REPO, new Map()), relations }
}

describe('epic_bundle_cli.fetch_backlog — the reads the listing makes unnecessary', () => {
	it('reads nothing for an issue GitHub reports no blockers on', async () => {
		const { relations } = await fetch_with([{ number: SUBJECT, blocked_by_count: NO_BLOCKERS }])

		expect(relations).not.toHaveBeenCalled()
	})

	it('still reads an issue that has blockers', async () => {
		const { relations } = await fetch_with([{ number: SUBJECT, blocked_by_count: ONE_BLOCKER }])

		expect(relations).toHaveBeenCalledWith(String(SUBJECT))
	})

	// A row the listing carries no summary for — a pull request is the case that occurs, and the
	// listing filters those out client-side, so this is the guard rather than the everyday path.
	it('reads a row the listing carries no count for rather than reading it as zero', async () => {
		const { relations } = await fetch_with([{ number: SUBJECT }])

		expect(relations).toHaveBeenCalledWith(String(SUBJECT))
	})

	it('reads a row whose count came back null', async () => {
		// eslint-disable-next-line unicorn/no-null -- the absent summary arrives as JSON null
		const { relations } = await fetch_with([{ number: SUBJECT, blocked_by_count: null }])

		expect(relations).toHaveBeenCalledWith(String(SUBJECT))
	})
})

describe('epic_bundle_cli.fetch_backlog — a mixed backlog', () => {
	const MIXED: ReadonlyArray<Row> = [
		{ number: SUBJECT, blocked_by_count: NO_BLOCKERS },
		{ number: RELATED, blocked_by_count: ONE_BLOCKER },
		{ number: OTHER_RELATED, blocked_by_count: NO_BLOCKERS },
	]

	it('reads only the rows that have blockers', async () => {
		const { relations } = await fetch_with(MIXED)

		expect(relations.mock.calls).toEqual([[String(RELATED)]])
	})

	// The skip must not borrow the failure signal: a row answered from the listing declares no
	// blockers, where an unreadable one is a verdict built on data that never arrived.
	it('reports only the row whose read failed as unreadable', async () => {
		const { backlog } = await fetch_with(MIXED)

		expect(backlog.unreadable).toEqual([RELATED])
	})

	it('keeps every row, in order, with the skipped ones declaring no blockers', async () => {
		const { backlog } = await fetch_with(MIXED)

		expect(backlog.issues.map((issue) => [issue.number, issue.blocked_by])).toEqual([
			[SUBJECT, []],
			[RELATED, []],
			[OTHER_RELATED, []],
		])
	})
})

// The four verdicts, each driven by a backlog whose every row reports zero blockers — so the command
// makes no per-issue read at all and must still print exactly what it printed before.
function epic_row(number: number, child: number): Record<string, unknown> {
	return { number, body: `- [ ] #${String(child)}` }
}

async function report_with(
	epics: ReadonlyArray<Record<string, unknown>>,
	rows: ReadonlyArray<Row>,
): Promise<{ printed: string; relations: MockInstance }> {
	vi.spyOn(git_gh_command, 'issue_list_by_label').mockResolvedValue(listing_of(epics))
	vi.spyOn(git_gh_command, 'issue_list_open_bodies').mockResolvedValue(
		listing_of(rows.map((row) => listing_row({ blocked_by_count: NO_BLOCKERS, ...row }))),
	)
	const relations = vi
		.spyOn(git_gh_command, 'issue_get_state_and_relations')
		.mockResolvedValue(undefined)
	const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

	try {
		await epic_bundle_cli.report_for(SUBJECT, REPO)

		return { printed: info.mock.calls.map((call) => String(call[0])).join('\n'), relations }
	} finally {
		info.mockRestore()
	}
}

const FOLLOWS_RELATED = `follows #${String(RELATED)}`
const NO_EPICS: ReadonlyArray<Record<string, unknown>> = []

// The command's own headline for an action, read from its table rather than spelled out again here —
// a second copy of the wording would go on passing after the printed line changed.
function action_line(action: string): string {
	return epic_bundle_cli.ACTION_LINES[action] ?? ''
}

describe('epic_bundle_cli.report_for — every verdict, with no per-issue read at all', () => {
	it('says the issue is already in an epic', async () => {
		const { printed, relations } = await report_with(
			[epic_row(EPIC, SUBJECT)],
			[{ number: SUBJECT }],
		)

		expect(printed).toContain(epic_bundle_cli.ALREADY_TRACKED_LINE)
		expect(relations).not.toHaveBeenCalled()
	})

	it('says there is nothing to bundle', async () => {
		const { printed, relations } = await report_with(NO_EPICS, [
			{ number: SUBJECT },
			{ number: RELATED },
		])

		expect(printed).toContain(action_line('none'))
		expect(relations).not.toHaveBeenCalled()
	})

	it('adds it to the epic that already tracks a related issue', async () => {
		const { printed, relations } = await report_with(
			[epic_row(EPIC, RELATED)],
			[{ number: SUBJECT, body: FOLLOWS_RELATED }, { number: RELATED }],
		)

		expect(printed).toContain(action_line('add_to_epic'))
		expect(relations).not.toHaveBeenCalled()
	})
})

describe('epic_bundle_cli.report_for — the verdicts that propose a new epic', () => {
	it('creates an epic for a related pair nothing tracks', async () => {
		const { printed, relations } = await report_with(NO_EPICS, [
			{ number: SUBJECT, body: FOLLOWS_RELATED },
			{ number: RELATED },
		])

		expect(printed).toContain(action_line('create_epic'))
		expect(relations).not.toHaveBeenCalled()
	})

	it('asks when the related issues sit in more than one epic', async () => {
		const { printed, relations } = await report_with(
			[epic_row(EPIC, RELATED), epic_row(OTHER_EPIC, OTHER_RELATED)],
			[
				{ number: SUBJECT, body: `${FOLLOWS_RELATED} and #${String(OTHER_RELATED)}` },
				{ number: RELATED },
				{ number: OTHER_RELATED },
			],
		)

		expect(printed).toContain(action_line('ask'))
		expect(relations).not.toHaveBeenCalled()
	})
})
