import {
	auto_ok_fixture,
	FAILURE_EXIT_CODE,
	SUCCESS_EXIT_CODE,
} from '#scripts/auto-ok/auto-ok-fixture'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_publication_state } from '#scripts/issue/issue-publication-state'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_pending_publication } from './backlog-pending-publication'
import { backlog_plan_cli } from './backlog-plan-cli'

// joshuafolkken/kit#8087: the prepared issues holding an open issue back, each beside the issue it holds.

const { REPO } = backlog_fixture
const OTHER_REPO = 'someone/elsewhere'
const PENDING = 8030
const WAITING = 8026
const PUBLISHED = 8040
const CHAIN_WAITING = 8041
const LONE_PENDING = 8057
const CLOSED_BLOCKER = 8001
const PAIR_LINE = '#8030 pending publication ← #8026'
const FLAG = '--pending-publication'
const PENDING_BODY = issue_publication_state.prepare('Prepared.', [])

const streams = auto_ok_fixture.console_streams()

interface ChildSpec {
	number: number
	body?: string
	blockers?: ReadonlyArray<number>
	repo?: string
}

function child({ number, body = 'Body.', blockers = [], repo = REPO }: ChildSpec): EpicChild {
	return {
		number,
		repo,
		state: 'OPEN',
		labels: [],
		blocked_by: blockers.map((blocker) => ({ repo, number: blocker })),
		body,
	}
}

function row(spec: ChildSpec): Record<string, unknown> {
	const blockers = spec.blockers ?? []

	return {
		number: spec.number,
		title: `Issue ${String(spec.number)}`,
		labels: [],
		body: spec.body ?? 'Body.',
		blockedBy: { nodes: blockers.map((number) => ({ number })), totalCount: blockers.length },
	}
}

const BACKLOG: ReadonlyArray<ChildSpec> = [
	{ number: PENDING, body: PENDING_BODY },
	{ number: WAITING, blockers: [PENDING] },
	{ number: PUBLISHED },
	{ number: CHAIN_WAITING, blockers: [PUBLISHED, CLOSED_BLOCKER] },
	{ number: LONE_PENDING, body: PENDING_BODY },
]

describe('backlog_pending_publication.pairs_of', () => {
	it('pairs a prepared blocker with the issue it blocks, not a published one', () => {
		expect(
			backlog_pending_publication.pairs_of(
				BACKLOG.map((spec) => child(spec)),
				REPO,
			),
		).toStrictEqual([{ blocker: PENDING, waiting: WAITING }])
	})

	it('leaves out a prepared issue that blocks nothing', () => {
		const children = [child({ number: LONE_PENDING, body: PENDING_BODY })]

		expect(backlog_pending_publication.pairs_of(children, REPO)).toStrictEqual([])
	})

	it('leaves out a blocker that is not in the open set or is in another repository', () => {
		const children = [
			child({ number: WAITING, blockers: [CLOSED_BLOCKER] }),
			child({ number: PENDING, body: PENDING_BODY, repo: OTHER_REPO }),
			child({ number: CHAIN_WAITING, blockers: [PENDING] }),
		]

		expect(backlog_pending_publication.pairs_of(children, REPO)).toStrictEqual([])
	})
})

describe('backlog_pending_publication.lines_of', () => {
	it('prints one line per pair, then the publish command', () => {
		expect(
			backlog_pending_publication.lines_of([{ blocker: PENDING, waiting: WAITING }]),
		).toStrictEqual([PAIR_LINE, backlog_pending_publication.PUBLISH_LINE])
	})

	it('says so when no pair exists', () => {
		expect(backlog_pending_publication.lines_of([])).toStrictEqual([
			backlog_pending_publication.NONE_LINE,
		])
	})
})

const BACKLOG_JSON = JSON.stringify(BACKLOG.map((spec) => row(spec)))

function stub_listing(json: string | undefined, is_capped: boolean): void {
	vi.spyOn(git_gh_command, 'issue_list_open_relations').mockResolvedValue({ json, is_capped })
}

describe('backlog:plan --pending-publication', () => {
	beforeEach(() => {
		vi.restoreAllMocks()
		vi.spyOn(console, 'info').mockImplementation(streams.info)
		vi.spyOn(console, 'error').mockImplementation(streams.error)
		streams.reset()
		vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(REPO)
	})

	it('lists the pairs from the open relations listing', async () => {
		stub_listing(BACKLOG_JSON, false)

		await expect(backlog_plan_cli.run([FLAG])).resolves.toBe(SUCCESS_EXIT_CODE)
		expect(streams.stdout()).toContain(PAIR_LINE)
	})

	it('fails on an unreadable listing rather than reporting no pair', async () => {
		stub_listing(undefined, false)

		await expect(backlog_plan_cli.run([FLAG])).resolves.toBe(FAILURE_EXIT_CODE)
		expect(streams.stderr()).toContain(backlog_pending_publication.UNREADABLE_MESSAGE)
	})

	it('fails when the repository name cannot be read', async () => {
		vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(undefined)

		await expect(backlog_plan_cli.run([FLAG])).resolves.toBe(FAILURE_EXIT_CODE)
		expect(streams.stderr()).toContain(backlog_pending_publication.UNREADABLE_MESSAGE)
	})

	it('names the flag in the usage line', async () => {
		await expect(backlog_plan_cli.run(['--unknown-option'])).resolves.toBe(FAILURE_EXIT_CODE)
		expect(streams.stderr()).toContain(FLAG)
	})

	it('warns that a cut listing can miss pairs', async () => {
		stub_listing(BACKLOG_JSON, true)

		await expect(backlog_plan_cli.run([FLAG])).resolves.toBe(SUCCESS_EXIT_CODE)
		expect(streams.stderr()).toContain(backlog_pending_publication.TRUNCATED_MESSAGE)
	})
})
