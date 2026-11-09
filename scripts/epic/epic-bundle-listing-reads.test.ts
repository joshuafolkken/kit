import { git_gh_command } from '#scripts/gh/git-gh-command'
import { listing_of } from '#scripts/gh/git-gh-issue-list-fixture'
import { describe, expect, it, vi, type MockInstance } from 'vitest'
import { epic_bundle_cli } from './epic-bundle-cli'
import { epic_bundle_fixture } from './epic-bundle-fixture'

// joshuafolkken/kit#6796: the blocker relations ride on the open listing (`blockedBy`, read in one
// GraphQL query per hundred rows), so `epic:bundle` makes no per-issue relation read at all. Read one
// issue at a time they cost two REST requests per open issue declaring a blocker — the bulk of an
// `issue:file` run's calls.

const REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/other'
const SUBJECT = 10
const RELATED = 11
const OTHER_RELATED = 12
const BLOCKER = 13
const EPIC = 100
const OTHER_EPIC = 101

interface Row {
	number: number
	body?: string
	blockedBy?: { nodes: Array<Record<string, unknown>> }
}

interface Reads {
	backlog: Awaited<ReturnType<typeof epic_bundle_cli.fetch_backlog>>
	relations: MockInstance<typeof git_gh_command.issue_get_state_and_relations>
	bodies: MockInstance<typeof git_gh_command.issue_list_open_bodies>
}

function listing_row(row: Row): Record<string, unknown> {
	return { title: '', body: '', ...row }
}

// Both listings and the per-issue relation read, mocked, so a case can assert on which listing was
// asked and that the per-issue read was not.
async function fetch_with(
	rows: ReadonlyArray<Row>,
	options?: { include_relations?: boolean },
): Promise<Reads> {
	const listing = listing_of(rows.map((row) => listing_row(row)))

	vi.spyOn(git_gh_command, 'issue_list_open_relations').mockResolvedValue(listing)
	const bodies = vi.spyOn(git_gh_command, 'issue_list_open_bodies').mockResolvedValue(listing)
	const relations = vi.spyOn(git_gh_command, 'issue_get_state_and_relations')
	const backlog = await epic_bundle_cli.fetch_backlog(REPO, new Map(), undefined, options)

	return { backlog, relations, bodies }
}

describe('epic_bundle_cli.fetch_backlog — relations from the listing', () => {
	it('makes no per-issue relation read', async () => {
		const { relations } = await fetch_with([
			{ number: SUBJECT, blockedBy: { nodes: [{ number: BLOCKER }] } },
		])

		expect(relations).not.toHaveBeenCalled()
	})

	it('carries each row blocker as a reference in this repository', async () => {
		const { backlog } = await fetch_with([
			{ number: SUBJECT, blockedBy: { nodes: [{ number: BLOCKER, state: 'OPEN' }] } },
		])

		expect(backlog.issues[0]?.blocked_by).toEqual([{ repo: REPO, number: BLOCKER, state: 'OPEN' }])
	})

	it('keeps a blocker in another repository in that repository', async () => {
		const repository_url = `https://api.github.com/repos/${OTHER_REPO}`
		const { backlog } = await fetch_with([
			{ number: SUBJECT, blockedBy: { nodes: [{ number: BLOCKER, repository_url }] } },
		])

		expect(backlog.issues[0]?.blocked_by).toEqual([{ repo: OTHER_REPO, number: BLOCKER }])
	})

	it('reads a row with no relations as declaring no blockers', async () => {
		const { backlog } = await fetch_with([{ number: SUBJECT }])

		expect(backlog.issues[0]?.blocked_by).toEqual([])
	})

	it('reports no unreadable issue, since nothing is read one at a time', async () => {
		const { backlog } = await fetch_with([{ number: SUBJECT }, { number: RELATED }])

		expect(backlog.unreadable).toEqual([])
	})

	// `issue:scout` asks about an issue that does not exist yet; relations cannot change its answer.
	it('lists without relations when the caller asks for none', async () => {
		const { bodies } = await fetch_with([{ number: SUBJECT }], { include_relations: false })

		expect(bodies).toHaveBeenCalledOnce()
	})
})

function epic_row(number: number, child: number): Record<string, unknown> {
	return { number, body: `- [ ] #${String(child)}` }
}

async function report_with(
	epics: ReadonlyArray<Record<string, unknown>>,
	rows: ReadonlyArray<Row>,
): Promise<{ printed: string; relations: MockInstance }> {
	vi.spyOn(git_gh_command, 'issue_list_by_label').mockResolvedValue(listing_of(epics))
	vi.spyOn(git_gh_command, 'issue_list_open_relations').mockResolvedValue(
		listing_of(rows.map((row) => listing_row(row))),
	)
	const relations = vi.spyOn(git_gh_command, 'issue_get_state_and_relations')
	const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

	try {
		await epic_bundle_cli.report_for(SUBJECT, REPO)

		return { printed: info.mock.calls.map((call) => String(call[0])).join('\n'), relations }
	} finally {
		info.mockRestore()
	}
}

const FOLLOWS_RELATED = epic_bundle_fixture.in_acceptance(`follows #${String(RELATED)}`)
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

	// The relation the listing carries is a bundle signal on its own, with no body reference.
	it('creates an epic for a pair joined only by a listed blocker', async () => {
		const { printed } = await report_with(NO_EPICS, [
			{ number: SUBJECT, blockedBy: { nodes: [{ number: RELATED }] } },
			{ number: RELATED },
		])

		expect(printed).toContain(action_line('create_epic'))
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
