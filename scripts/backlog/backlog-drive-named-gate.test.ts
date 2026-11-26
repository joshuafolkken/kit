import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { epic_busy, type BusyRead } from '#scripts/epic/epic-busy'
import { epic_solo_stale } from '#scripts/epic/epic-solo-stale'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_common_directory } from '#scripts/git/git-common-directory'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { cutoff_of } from '#scripts/git/listing-cutoff'
import { issue_state_cli, type StateRead } from '#scripts/issue/issue-state-cli'
import { lane_plan } from '#scripts/lane/lane-plan'
import { lane_state } from '#scripts/lane/lane-state'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backlog_drive_named_gate, type NamedPlain } from './backlog-drive-named-gate'
import { backlog_drive_named_scope } from './backlog-drive-named-scope'
import type { Declared } from './backlog-overlap'

// joshuafolkken/kit#8953: the named issues run side by side, so they pass the pool's `run:solo` hold
// and path-overlap separation before they launch.

const REPO = 'joshuafolkken/kit'
const RUNNING = 3
const PLAIN = 10
const OTHER = 11
const SHARED_PATH = 'scripts/lane/lane-overrun.ts'
const RUNNING_ISSUE: OpenIssueData = {
	number: RUNNING,
	title: 'running',
	createdAt: '2026-11-25T00:00:00Z',
	blockedBy: undefined,
	labels: [{ name: 'in-progress' }],
}
const BUSY: BusyRead = { kind: 'busy', issues: [RUNNING_ISSUE] }
const IDLE: BusyRead = { kind: 'idle' }
const UNREADABLE: StateRead = { kind: 'unreadable' }
const LISTING_LIMIT = 100
const PLANNED_AT = '2026-11-27T00:00:00.000Z'
const BOARD_DIRECTORY = 'scripts/run/board/'
const BOARD_FILE = 'scripts/run/board/run-board-layout-types.ts'
const CANDIDATE: OpenIssueData = {
	number: PLAIN,
	title: 'candidate',
	createdAt: '2026-11-26T00:00:00Z',
	blockedBy: undefined,
	labels: [],
	body: `\`${BOARD_FILE}\``,
}
const make_directory = temporary_directory('test')

function plain(number: number, labels: ReadonlyArray<string> = []): NamedPlain {
	return { number, labels }
}

function child_labels(labels: ReadonlyArray<string>): void {
	vi.spyOn(issue_state_cli, 'read_issue').mockResolvedValue({
		kind: 'state',
		state: { state: 'OPEN', labels, is_human_review: false },
	})
}

// The scope the gate reads, with every gathered epic child read as an open issue with no labels.
function scope_of(read: BusyRead, declared: Declared = new Map()): void {
	child_labels([])
	vi.spyOn(backlog_drive_named_scope, 'read').mockResolvedValue({
		read,
		repo: REPO,
		declared,
		lanes: new Map(),
	})
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('backlog_drive_named_gate.admitted', () => {
	it('admits every plain issue in the typed order when nothing holds them', async () => {
		scope_of(IDLE)

		expect(
			await backlog_drive_named_gate.admitted([plain(PLAIN), plain(OTHER)], [], []),
		).toStrictEqual([PLAIN, OTHER])
	})

	it('withholds a run:solo issue while a lane is busy', async () => {
		scope_of(BUSY)

		const admitted = await backlog_drive_named_gate.admitted(
			[plain(PLAIN, ['run:solo']), plain(OTHER)],
			[String(RUNNING)],
			[],
		)

		expect(admitted).not.toContain(PLAIN)
	})

	it('withholds an issue declaring a path a running lane declares', async () => {
		const shared = new Set([SHARED_PATH])

		scope_of(
			BUSY,
			new Map([
				[RUNNING, shared],
				[PLAIN, shared],
			]),
		)

		const admitted = await backlog_drive_named_gate.admitted(
			[plain(PLAIN), plain(OTHER)],
			[String(RUNNING)],
			[],
		)

		expect(admitted).toStrictEqual([OTHER])
	})
})

describe('backlog_drive_named_gate.admitted — epic children gathered this tick', () => {
	it('withholds a run:solo issue beside a gathered epic child, with no lane busy', async () => {
		scope_of(IDLE)

		const admitted = await backlog_drive_named_gate.admitted(
			[plain(PLAIN, ['run:solo'])],
			[],
			[String(RUNNING)],
		)

		expect(admitted).toStrictEqual([])
	})

	it('withholds an issue declaring a path a gathered epic child declares', async () => {
		const shared = new Set([SHARED_PATH])

		scope_of(
			IDLE,
			new Map([
				[RUNNING, shared],
				[PLAIN, shared],
			]),
		)

		const admitted = await backlog_drive_named_gate.admitted(
			[plain(PLAIN), plain(OTHER)],
			[],
			[String(RUNNING)],
		)

		expect(admitted).toStrictEqual([OTHER])
	})

	it('reads the gathered children with the lanes in flight', async () => {
		scope_of(IDLE)
		const read = vi.spyOn(backlog_drive_named_scope, 'read')

		await backlog_drive_named_gate.admitted([plain(PLAIN)], ['4'], [String(RUNNING)])

		expect(read).toHaveBeenCalledWith([PLAIN], ['4', String(RUNNING)])
	})
})

describe('backlog_drive_named_gate.admitted — the labels of the gathered epic children', () => {
	it('withholds a plain issue beside a run:solo gathered epic child, with no lane busy', async () => {
		scope_of(IDLE)
		child_labels(['run:solo'])

		expect(
			await backlog_drive_named_gate.admitted([plain(PLAIN)], [], [String(RUNNING)]),
		).toStrictEqual([])
	})

	it('admits none when a gathered epic child is unreadable', async () => {
		scope_of(IDLE)
		vi.spyOn(issue_state_cli, 'read_issue').mockResolvedValue(UNREADABLE)

		expect(
			await backlog_drive_named_gate.admitted([plain(PLAIN)], [], [String(RUNNING)]),
		).toStrictEqual([])
	})
})

// The real scope over recorded plans: the listing is the only read of the candidates' bodies.
function listing_of(issues: ReadonlyArray<OpenIssueData>, busy: BusyRead): void {
	vi.spyOn(git_common_directory, 'repository').mockReturnValue(make_directory('named-gate-'))
	vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(REPO)
	vi.spyOn(epic_busy, 'read_repository').mockResolvedValue(busy)
	vi.spyOn(epic_solo_stale, 'release').mockImplementation(async (read) => ({ read }))
	vi.spyOn(lane_state, 'read_states').mockResolvedValue(new Map())
	vi.spyOn(auto_ok_cli, 'fetch_opted_in').mockResolvedValue({
		kind: 'read',
		issues: [...issues],
		cutoff: cutoff_of(issues.length, LISTING_LIMIT, false),
	})
}

function holder_planned(): void {
	lane_plan.record(
		{ issue: RUNNING, paths: [BOARD_DIRECTORY], planned_at: PLANNED_AT },
		process.cwd(),
	)
}

// joshuafolkken/kit#9031: an unplanned candidate claims the paths its body declares, as `lane:plan`
// reads it, so it is not launched beside a running lane whose plan covers them only to yield.
describe('backlog_drive_named_gate.admitted — the bodies of unplanned candidates', () => {
	it.each([
		{ name: 'the holder listed', listed: [CANDIDATE, RUNNING_ISSUE] },
		{ name: 'the holder unlisted', listed: [CANDIDATE] },
	])('withholds a candidate whose body meets a running plan, $name', async ({ listed }) => {
		listing_of(listed, BUSY)
		holder_planned()

		expect(await backlog_drive_named_gate.admitted([plain(PLAIN)], [], [])).toStrictEqual([])
	})

	it('withholds a candidate whose yielded plan meets a running plan', async () => {
		listing_of([{ ...CANDIDATE, body: '' }], BUSY)
		holder_planned()
		lane_plan.record(
			{ issue: PLAIN, paths: [BOARD_FILE], planned_at: PLANNED_AT, yielded: true },
			process.cwd(),
		)

		expect(await backlog_drive_named_gate.admitted([plain(PLAIN)], [], [])).toStrictEqual([])
	})

	it.each([
		{ name: 'no lane running', busy: IDLE, body: CANDIDATE.body },
		{ name: 'no path declared', busy: BUSY, body: '' },
	])('admits the candidate with $name', async ({ busy, body }) => {
		listing_of([{ ...CANDIDATE, body }], busy)
		holder_planned()

		expect(await backlog_drive_named_gate.admitted([plain(PLAIN)], [], [])).toStrictEqual([PLAIN])
	})
})

describe('backlog_drive_named_gate.admitted — nothing to gate', () => {
	it('admits none when the repository is unreadable', async () => {
		vi.spyOn(backlog_drive_named_scope, 'read').mockResolvedValue(undefined)

		expect(await backlog_drive_named_gate.admitted([plain(PLAIN)], [], [])).toStrictEqual([])
	})

	it('reads nothing for no plain issue', async () => {
		const read = vi.spyOn(backlog_drive_named_scope, 'read')

		expect(await backlog_drive_named_gate.admitted([], [], [])).toStrictEqual([])
		expect(read).not.toHaveBeenCalled()
	})
})
