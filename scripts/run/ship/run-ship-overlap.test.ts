import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { changed_paths } from '#scripts/git/changed-paths'
import { session_cite } from '#scripts/issue/session-cite'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import type { LaneInfo } from '#scripts/lane/lane-registry'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const spawn_mock = vi.hoisted(() => vi.fn())
const running_mock = vi.hoisted(() => vi.fn())
const since_mock = vi.hoisted(() => vi.fn())
const lanes_mock = vi.hoisted(() => vi.fn())
const conflicts_mock = vi.hoisted(() => vi.fn())
const own_paths_mock = vi.spyOn(changed_paths, 'read_changed_paths')

vi.mock('#scripts/git/git-diff-reads', () => ({
	git_diff_reads: {
		default_branch_reference: vi.fn().mockResolvedValue('refs/remotes/origin/main'),
	},
}))
vi.mock('#scripts/git/git-merge-conflicts', () => ({
	git_merge_conflicts: { working_tree_conflicts: conflicts_mock },
}))
vi.mock('#scripts/git/git-spawn', () => ({ git_spawn: { read: spawn_mock } }))
vi.mock('#scripts/lane/lane-handoff', () => ({
	lane_handoff: { is_ship_running: running_mock, ship_running_since: since_mock },
}))
vi.mock('#scripts/lane/lane-registry', () => ({ lane_registry: { list_lanes: lanes_mock } }))

const { run_ship_overlap } = await import('./run-ship-overlap')

// joshuafolkken/kit#3901: a ship waits, before its sync, for any other lane whose open pull request
// changes a path its own change does — an overlap no issue body declared — so the later lane merges
// the earlier one's change before its gate instead of meeting it as `DIRTY` after CI.

const scratch = mkdtempSync(path.join(tmpdir(), 'run-ship-overlap-test-'))
const SELF = '3901'
const EARLIER = '3870'
const OTHER = '3871'
const SHARED = '.claude/skills/workflow-commands/background-commands.md'
const OWN_ONLY = 'scripts/run/ship/run-ship-sync.ts'
const OTHER_ONLY = 'scripts/rules/rule.ts'
const NO_SLEEP = vi.fn().mockResolvedValue(undefined)
const EARLIER_LAUNCH = 1000
const LATER_LAUNCH = 2000

function lane(issue: string): LaneInfo {
	return {
		issue,
		branch: `${issue}-lane`,
		directory: `/lanes/${issue}`,
		seat: undefined,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		is_stranded: false,
	}
}

function ledger(name: string): string {
	return path.join(scratch, `${name}.jsonl`)
}

// `git -C <dir> diff …` answers each lane's pushed change; `rev-parse @{upstream}` succeeds for all.
function lane_diffs(diffs: Readonly<Record<string, ReadonlyArray<string>>>): void {
	spawn_mock.mockImplementation(async (argv: ReadonlyArray<string>) => {
		const directory = argv[1] ?? ''
		const issue = path.basename(directory)

		return argv.includes('diff') ? (diffs[issue] ?? []).join('\n') : await Promise.resolve('')
	})
}

// The launch time each lane's running ship carries; a lane missing from `since` has no running ship.
function launches(since: Readonly<Record<string, number>>): void {
	since_mock.mockImplementation((issue: string) => since[issue])
}

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

beforeEach(() => {
	own_paths_mock.mockReset().mockResolvedValue([SHARED, OWN_ONLY])
	lanes_mock.mockReset().mockResolvedValue([lane(SELF), lane(EARLIER), lane(OTHER)])
	running_mock.mockReset().mockReturnValue(true)
	launches({ [SELF]: LATER_LAUNCH, [EARLIER]: EARLIER_LAUNCH, [OTHER]: EARLIER_LAUNCH })
	NO_SLEEP.mockClear()
	conflicts_mock.mockReset().mockReturnValue(undefined)
	lane_diffs({ [EARLIER]: [SHARED, OTHER_ONLY], [OTHER]: [OTHER_ONLY] })
})

describe('run_ship_overlap.await_overlap — an undeclared overlap with an open pull request', () => {
	it('waits until the earlier overlapping ship ends, then records the cleared wait', async () => {
		running_mock.mockImplementation(
			(issue: string) => issue !== EARLIER || NO_SLEEP.mock.calls.length === 0,
		)
		const target = ledger('cleared')

		const record = await run_ship_overlap.await_overlap(SELF, { sleeper: NO_SLEEP, ledger: target })

		expect(NO_SLEEP).toHaveBeenCalledTimes(1)
		expect(record).toMatchObject({ issue: 3901, lanes: [3870], paths: [SHARED], is_cleared: true })
		expect(lane_ledger.read_entries(target)).toMatchObject([
			{ kind: 'overlap', issue: 3901, lanes: [3870], paths: [SHARED], is_cleared: true },
		])
	})

	it('gives up after the bounded wait and records that it did', async () => {
		const target = ledger('gave-up')

		const record = await run_ship_overlap.await_overlap(SELF, { sleeper: NO_SLEEP, ledger: target })

		expect(NO_SLEEP).toHaveBeenCalledTimes(run_ship_overlap.MAX_WAIT_ATTEMPTS - 1)
		expect(record?.is_cleared).toBe(false)
		expect(lane_ledger.read_entries(target)).toHaveLength(1)
	})

	it('matches a non-ASCII path spelled unquoted, as its own change spells it', async () => {
		const unicode = 'docs/日本語.md'

		own_paths_mock.mockResolvedValue([unicode])
		spawn_mock.mockImplementation(async (argv: ReadonlyArray<string>) => {
			if (!argv.includes('diff')) return ''

			return argv.includes('core.quotePath=false') ? unicode : String.raw`"docs/\346\227\245.md"`
		})

		const record = await run_ship_overlap.await_overlap(SELF, {
			sleeper: NO_SLEEP,
			ledger: ledger('unicode'),
		})

		expect(record?.paths).toStrictEqual([unicode])
	})
})

describe('run_ship_overlap.await_overlap — nothing to wait for', () => {
	it('does nothing when no other lane changes a path this lane changed', async () => {
		lane_diffs({ [EARLIER]: [OTHER_ONLY], [OTHER]: [OTHER_ONLY] })
		const target = ledger('disjoint')

		expect(
			await run_ship_overlap.await_overlap(SELF, { sleeper: NO_SLEEP, ledger: target }),
		).toBeUndefined()
		expect(lane_ledger.read_entries(target)).toStrictEqual([])
		expect(NO_SLEEP).not.toHaveBeenCalled()
	})

	it('does not wait on an overlapping lane whose ship is not running', async () => {
		launches({ [SELF]: LATER_LAUNCH })

		expect(await run_ship_overlap.await_overlap(SELF, { sleeper: NO_SLEEP })).toBeUndefined()
	})

	it('does not wait on an overlapping lane that has not pushed its branch', async () => {
		spawn_mock.mockImplementation(async (argv: ReadonlyArray<string>) => {
			if (argv.includes('diff')) return SHARED

			throw new Error('no upstream')
		})

		expect(await run_ship_overlap.await_overlap(SELF, { sleeper: NO_SLEEP })).toBeUndefined()
	})

	it('ignores its own lane and a stranded lane', async () => {
		lanes_mock.mockResolvedValue([lane(SELF), { ...lane(EARLIER), is_stranded: true }])
		lane_diffs({ [SELF]: [SHARED], [EARLIER]: [SHARED] })

		expect(await run_ship_overlap.await_overlap(SELF, { sleeper: NO_SLEEP })).toBeUndefined()
	})

	it('reads an unreadable lane list as no overlap rather than blocking the sync', async () => {
		lanes_mock.mockRejectedValue(new Error('git worktree list failed'))

		expect(await run_ship_overlap.await_overlap(SELF, { sleeper: NO_SLEEP })).toBeUndefined()
	})
})

// The lanes `issue`'s ship would wait on, where both lanes change only `SHARED`.
async function waited_lanes(issue: string): Promise<ReadonlyArray<number> | undefined> {
	const record = await run_ship_overlap.await_overlap(issue, { sleeper: NO_SLEEP })

	return record?.lanes
}

describe('run_ship_overlap.await_overlap — two overlapping ships order by launch', () => {
	beforeEach(() => {
		lanes_mock.mockResolvedValue([lane(SELF), lane(EARLIER)])
		lane_diffs({ [SELF]: [SHARED], [EARLIER]: [SHARED] })
		own_paths_mock.mockResolvedValue([SHARED])
	})

	it('never lets two overlapping ships in their sync wait on each other', async () => {
		expect(await waited_lanes(SELF)).toStrictEqual([Number(EARLIER)])
		expect(await waited_lanes(EARLIER)).toBeUndefined()
	})

	it('breaks a tie in launch time toward the lower issue number', async () => {
		launches({ [SELF]: EARLIER_LAUNCH, [EARLIER]: EARLIER_LAUNCH })

		expect(await waited_lanes(SELF)).toStrictEqual([Number(EARLIER)])
		expect(await waited_lanes(EARLIER)).toBeUndefined()
	})

	it('waits on every running ship when its own ship has no launch record', async () => {
		launches({ [EARLIER]: LATER_LAUNCH })

		expect(await waited_lanes(SELF)).toStrictEqual([Number(EARLIER)])
	})
})

// joshuafolkken/kit#4348: a shared path is waited on only where merging the two heads would stop.
describe('run_ship_overlap.await_overlap — only a real conflict is waited on', () => {
	it('goes straight to the sync when the shared paths merge cleanly', async () => {
		conflicts_mock.mockReturnValue([])
		const target = ledger('clean-merge')

		expect(
			await run_ship_overlap.await_overlap(SELF, { sleeper: NO_SLEEP, ledger: target }),
		).toBeUndefined()
		expect(lane_ledger.read_entries(target)).toStrictEqual([])
		expect(NO_SLEEP).not.toHaveBeenCalled()
	})

	it('waits on a conflicting path and records it as the reason', async () => {
		conflicts_mock.mockReturnValue([SHARED])
		const target = ledger('conflict')

		const record = await run_ship_overlap.await_overlap(SELF, { sleeper: NO_SLEEP, ledger: target })

		expect(conflicts_mock).toHaveBeenCalledWith(expect.any(String), [SHARED], process.cwd())
		expect(record).toMatchObject({ lanes: [Number(EARLIER)], paths: [SHARED] })
		expect(lane_ledger.read_entries(target)).toMatchObject([{ kind: 'overlap', paths: [SHARED] }])
	})
})

describe('run_ship_overlap.await_overlap — what a conflict is counted against', () => {
	const CATALOG = 'docs/josh-command-catalog.md'

	it('falls back to every shared path when the other lane head cannot be read', async () => {
		spawn_mock.mockImplementation(async (argv: ReadonlyArray<string>) => {
			if (argv.includes('rev-parse') && argv.includes('HEAD')) throw new Error('no head')

			return argv.includes('diff') ? SHARED : await Promise.resolve('')
		})

		const record = await run_ship_overlap.await_overlap(SELF, { sleeper: NO_SLEEP })

		expect(conflicts_mock).not.toHaveBeenCalled()
		expect(record?.paths).toStrictEqual([SHARED])
	})

	it('does not count a conflict on a file the sync regenerates', async () => {
		own_paths_mock.mockResolvedValue([CATALOG])
		lane_diffs({ [EARLIER]: [CATALOG] })
		conflicts_mock.mockReturnValue([CATALOG])

		expect(await run_ship_overlap.await_overlap(SELF, { sleeper: NO_SLEEP })).toBeUndefined()
	})
})

describe('run_ship_overlap.note', () => {
	it('names the lanes and the shared paths, or nothing where nothing overlapped', () => {
		const record = { issue: 1, lanes: [2, 3], paths: ['a', 'b'], waited_ms: 0, is_cleared: true }

		expect(run_ship_overlap.note(record)).toBe(
			`waited for ${session_cite.issue(2)}, ${session_cite.issue(3)}, whose open pull requests conflict on: a, b`,
		)
		expect(run_ship_overlap.note({ ...record, is_cleared: false })).toMatch(/^gave up waiting for/u)
		expect(run_ship_overlap.note(undefined)).toBe('')
	})
})
