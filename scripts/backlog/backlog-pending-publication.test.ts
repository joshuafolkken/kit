import {
	auto_ok_fixture,
	FAILURE_EXIT_CODE,
	SUCCESS_EXIT_CODE,
} from '#scripts/auto-ok/auto-ok-fixture'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { epic_index, type FetchedEpics } from '#scripts/epic/epic-index'
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
const LONE_LINE = '#8057 pending publication — missing: epic placement, publish'
const EPIC_STEP = 'epic placement'
const PLAN_STEP = 'plan record'
const PUBLISH_STEP = 'publish'
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

	it('says so when no pair and no pending issue exists', () => {
		expect(backlog_pending_publication.lines_of([])).toStrictEqual([
			backlog_pending_publication.NONE_LINE,
		])
	})

	it('keeps the wording of the none, publish and truncation lines', () => {
		expect(backlog_pending_publication.NONE_LINE).toBe('No issue is pending publication.')
		expect(backlog_pending_publication.PUBLISH_LINE).toBe(
			'Place each issue in an epic, record its plan, then publish the epic: pnpm josh issue:file --publish <epic>',
		)
		expect(backlog_pending_publication.TRUNCATED_MESSAGE).toMatch(
			/^⚠ The open-issue or epic listing stopped at \d+ rows, so issues past the cut are missing or misread\.$/u,
		)
	})

	it('prints each pending issue with its missing steps after the pairs', () => {
		expect(
			backlog_pending_publication.lines_of(
				[{ blocker: PENDING, waiting: WAITING }],
				[{ number: LONE_PENDING, steps: [EPIC_STEP, PUBLISH_STEP] }],
			),
		).toStrictEqual([PAIR_LINE, LONE_LINE, backlog_pending_publication.PUBLISH_LINE])
	})
})

// joshuafolkken/kit#8173: a pending issue in no epic that blocks nothing has no pair, yet is listed.
describe('backlog_pending_publication.pending_of', () => {
	it('lists a pending issue in no epic that blocks nothing, with every missing step', () => {
		expect(
			backlog_pending_publication.pending_of(
				BACKLOG.map((spec) => child(spec)),
				REPO,
				new Set([PENDING]),
			),
		).toStrictEqual([
			{ number: PENDING, steps: [PLAN_STEP, PUBLISH_STEP] },
			{ number: LONE_PENDING, steps: [EPIC_STEP, PLAN_STEP, PUBLISH_STEP] },
		])
	})

	it('names only publish for a placed, planned issue and skips another repository', () => {
		const children = [
			{ ...child({ number: PENDING, body: PENDING_BODY }), labels: ['run:planned'] },
			child({ number: LONE_PENDING, body: PENDING_BODY, repo: OTHER_REPO }),
		]

		expect(
			backlog_pending_publication.pending_of(children, REPO, new Set([PENDING])),
		).toStrictEqual([{ number: PENDING, steps: [PUBLISH_STEP] }])
	})
})

const BACKLOG_JSON = JSON.stringify(BACKLOG.map((spec) => row(spec)))

function stub_listing(json: string | undefined, is_capped: boolean): void {
	vi.spyOn(git_gh_command, 'issue_list_open_relations').mockResolvedValue({ json, is_capped })
}

// One open epic tracking the blocker, so the lone pending issue is the one in no epic.
function stub_epics(fetched: FetchedEpics | undefined): void {
	vi.spyOn(epic_index, 'fetch_epics').mockResolvedValue(fetched)
}

const EPICS: FetchedEpics = {
	epics: [{ number: 8000, body: `- [ ] #${String(PENDING)}` }],
	cutoff: 'none',
}
const ALL_STEPS_LINE = '#8057 pending publication — missing: epic placement, plan record, publish'

function stub_cli(): void {
	vi.restoreAllMocks()
	vi.spyOn(console, 'info').mockImplementation(streams.info)
	vi.spyOn(console, 'error').mockImplementation(streams.error)
	streams.reset()
	vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(REPO)
	stub_epics(EPICS)
}

describe('backlog:plan --pending-publication — every pending issue', () => {
	beforeEach(stub_cli)

	it('lists the pairs and every pending issue from the open relations listing', async () => {
		stub_listing(BACKLOG_JSON, false)

		await expect(backlog_plan_cli.run([FLAG])).resolves.toBe(SUCCESS_EXIT_CODE)
		expect(streams.stdout()).toContain(PAIR_LINE)
		expect(streams.stdout()).toContain(ALL_STEPS_LINE)
		expect(streams.stderr()).not.toContain(backlog_pending_publication.TRUNCATED_MESSAGE)
	})

	it('lists a pending issue in no epic that blocks nothing rather than reporting none', async () => {
		stub_listing(JSON.stringify([row({ number: LONE_PENDING, body: PENDING_BODY })]), false)

		await expect(backlog_plan_cli.run([FLAG])).resolves.toBe(SUCCESS_EXIT_CODE)
		expect(streams.stdout()).toContain(ALL_STEPS_LINE)
		expect(streams.stdout()).not.toContain(backlog_pending_publication.NONE_LINE)
	})

	it('fails on an unreadable epic listing rather than naming every issue unplaced', async () => {
		stub_listing(BACKLOG_JSON, false)
		stub_epics(undefined)

		await expect(backlog_plan_cli.run([FLAG])).resolves.toBe(FAILURE_EXIT_CODE)
		expect(streams.stderr()).toContain(backlog_pending_publication.UNREADABLE_MESSAGE)
	})

	it('warns that a cut epic listing can misread placement', async () => {
		stub_listing(BACKLOG_JSON, false)
		stub_epics({ ...EPICS, cutoff: 'row_limit' })

		await expect(backlog_plan_cli.run([FLAG])).resolves.toBe(SUCCESS_EXIT_CODE)
		expect(streams.stderr()).toContain(backlog_pending_publication.TRUNCATED_MESSAGE)
	})
})

describe('backlog:plan --pending-publication', () => {
	beforeEach(stub_cli)

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
