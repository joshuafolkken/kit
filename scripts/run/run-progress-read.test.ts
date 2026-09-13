import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { OpenIssueData } from '#scripts/git/schemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#1520. The readings behind the progress line: the silence record, and the three
// answers a tick can produce — a child in flight, nothing in flight, and a listing nobody could read.

vi.mock('#scripts/epic/epic-busy', () => ({ epic_busy: { read_repository: vi.fn() } }))
vi.mock('#scripts/lane/lane-registry', () => ({ lane_registry: { list_lanes: vi.fn() } }))
vi.mock('./run-preflight', () => ({ run_preflight: { read_child_state: vi.fn() } }))
vi.mock('#scripts/git/git-command', () => ({ git_command: { git_directories: vi.fn() } }))
vi.mock('./run-hold', () => ({ run_hold: { read_hold: vi.fn(), hold_path: vi.fn() } }))
vi.mock('./run-carry', () => ({ run_carry: { read_carry: vi.fn(), carry_path: vi.fn() } }))

const { epic_busy } = await import('#scripts/epic/epic-busy')
const { lane_registry } = await import('#scripts/lane/lane-registry')
const { run_preflight } = await import('./run-preflight')
const { git_command } = await import('#scripts/git/git-command')
const { run_hold } = await import('./run-hold')
const { run_carry } = await import('./run-carry')
const { run_progress_read } = await import('./run-progress-read')

const read_repository = vi.mocked(epic_busy.read_repository)
const list_lanes = vi.mocked(lane_registry.list_lanes)
const read_child_state = vi.mocked(run_preflight.read_child_state)
const git_directories = vi.mocked(git_command.git_directories)
const read_hold = vi.mocked(run_hold.read_hold)
const read_carry = vi.mocked(run_carry.read_carry)
const hold_path = vi.mocked(run_hold.hold_path)
const carry_path = vi.mocked(run_carry.carry_path)

const REPO = 'joshuafolkken/kit'
const NOW = 1_800_000_000_000
const MINUTE = 60_000
const IN_PROGRESS = 'in-progress'
const WORKTREE_GIT_DIR = '/wt/.git'
const REPOSITORY_GIT_DIR = '/repo/.git'
// Valid record payloads for the run-started signals, built to their real shapes so the mocks need no
// type assertion (joshuafolkken/kit#1900).
const A_TIME = '2026-09-13T00:00:00Z'
const A_HOLD = { issue: '1900', taken_at: A_TIME, pid: 1 }
const A_CARRY = { invocation: 'backlogrun', started_at: A_TIME, merged: 0, filed: 0, cuts: 0 }
const A_LANE_OBSERVATION = { issue: '1900', state: 'open' }
const A_LANE_INFO = {
	issue: '1900',
	branch: '1900-lane',
	directory: '/lanes/1900',
	seat: 1,
	development_port: 5183,
	preview_port: 4183,
	output: undefined,
	is_stranded: false,
}

const temporary = { directory: '' }

function issue_row(number: number, labels: ReadonlyArray<string>): OpenIssueData {
	return {
		number,
		title: `issue ${String(number)}`,
		labels: labels.map((name) => ({ name })),
		createdAt: '2026-09-07T00:00:00Z',
	}
}

beforeEach(() => {
	temporary.directory = mkdtempSync(path.join(tmpdir(), 'josh-progress-'))
	list_lanes.mockResolvedValue([])
	read_child_state.mockResolvedValue({ branch_name: '1520-lane', pr_state: 'open' })
	git_directories.mockResolvedValue([WORKTREE_GIT_DIR, REPOSITORY_GIT_DIR])
	hold_path.mockReturnValue('/hold')
	carry_path.mockReturnValue('/carry')
	read_hold.mockReturnValue({ kind: 'free' })
	read_carry.mockReturnValue({ kind: 'none' })
})

afterEach(() => {
	rmSync(temporary.directory, { force: true, recursive: true })
	vi.resetAllMocks()
})

describe('the silence record', () => {
	it('round-trips the moment a report happened', () => {
		const target = path.join(temporary.directory, 'stamp.json')

		run_progress_read.mark(target, NOW)

		expect(run_progress_read.read_last_report(target)).toBe(NOW)
	})

	it('answers undefined for a record that is not there', () => {
		expect(
			run_progress_read.read_last_report(path.join(temporary.directory, 'absent.json')),
		).toBeUndefined()
	})

	it('answers undefined for a record it cannot parse, rather than trusting a broken one', () => {
		const target = path.join(temporary.directory, 'broken.json')

		writeFileSync(target, 'not json at all')

		expect(run_progress_read.read_last_report(target)).toBeUndefined()
	})

	it('answers undefined for a timestamp that is not a date', () => {
		expect(run_progress_read.parse_stamp('{"reported_at":"sometime"}')).toBeUndefined()
	})
})

describe('read_record_age — the transcript sample', () => {
	it('is unread when no path was given, rather than invented', () => {
		expect(run_progress_read.read_record_age([], NOW)).toBeUndefined()
	})

	it('is unread when nothing at the path could be sampled', () => {
		expect(
			run_progress_read.read_record_age([path.join(temporary.directory, 'missing.jsonl')], NOW),
		).toBeUndefined()
	})

	it('measures from the newest of the paths it could sample', () => {
		const older = path.join(temporary.directory, 'older.jsonl')
		const newer = path.join(temporary.directory, 'newer.jsonl')

		writeFileSync(older, 'line')
		writeFileSync(newer, 'line')
		utimesSync(older, new Date(NOW - 30 * MINUTE), new Date(NOW - 30 * MINUTE))
		utimesSync(newer, new Date(NOW - 2 * MINUTE), new Date(NOW - 2 * MINUTE))

		expect(run_progress_read.read_record_age([older, newer], NOW)).toBe(2 * MINUTE)
	})

	it('skips a path it could not sample rather than losing the ones it could', () => {
		const target = path.join(temporary.directory, 'unit.jsonl')

		writeFileSync(target, 'line')
		utimesSync(target, new Date(NOW - 5 * MINUTE), new Date(NOW - 5 * MINUTE))

		expect(
			run_progress_read.read_record_age(
				[path.join(temporary.directory, 'gone.jsonl'), target],
				NOW,
			),
		).toBe(5 * MINUTE)
	})
})

async function observe(): ReturnType<typeof run_progress_read.read_observations> {
	return await run_progress_read.read_observations({ now_ms: NOW, output_paths: [], repo: REPO })
}

describe('read_observations — the three answers a tick can give', () => {
	// A listing that arrived empty is the only one that can mean "there is nothing to report", and only
	// when no run has started (the default here). Both of the others saw less than the whole listing,
	// and reporting either as idle would be a confident absence built on a read nobody completed.
	it.each([
		['idle', 'idle'],
		['unreadable', 'unreadable'],
		['truncated', 'unreadable'],
	] as const)('reads a %s listing as %s', async (listing, expected) => {
		read_repository.mockResolvedValue({ kind: listing })

		await expect(observe()).resolves.toMatchObject({ kind: expected })
	})

	it('observes each child in flight with its labels and its pull request state', async () => {
		read_repository.mockResolvedValue({
			kind: 'busy',
			issues: [issue_row(1520, [IN_PROGRESS])],
		})

		await expect(observe()).resolves.toMatchObject({
			kind: 'observed',
			observations: { children: [{ issue: '1520', labels: [IN_PROGRESS], pr_state: 'open' }] },
		})
	})
})

describe('read_children and read_lanes', () => {
	it('reads a child with no labels as one with no labels', async () => {
		read_repository.mockResolvedValue({ kind: 'busy', issues: [issue_row(7, [])] })

		await expect(run_progress_read.read_children(REPO)).resolves.toEqual([
			{ issue: '7', labels: [], pr_state: 'open' },
		])
	})

	it('reports each open lane by issue and state', async () => {
		list_lanes.mockResolvedValue([
			{
				issue: '1520',
				branch: '1520-lane',
				directory: '/lanes/1520',
				seat: 1,
				development_port: 5183,
				preview_port: 4183,
				output: undefined,
				is_stranded: false,
			},
		])

		await expect(run_progress_read.read_lanes()).resolves.toEqual([
			{ issue: '1520', state: 'open' },
		])
	})
})

describe('has_run_started — a run underway, read from a mechanical record', () => {
	it('is true on a registered lane, without reading git at all', async () => {
		await expect(run_progress_read.has_run_started([A_LANE_OBSERVATION])).resolves.toBe(true)
		expect(git_directories).not.toHaveBeenCalled()
	})

	it.each([
		['held', { kind: 'held', hold: A_HOLD }],
		['stale', { kind: 'stale', hold: A_HOLD }],
	] as const)('is true when the work tree hold is %s', async (_label, read) => {
		read_hold.mockReturnValue(read)

		await expect(run_progress_read.has_run_started([])).resolves.toBe(true)
	})

	it.each([
		['carried', { kind: 'carried', carry: A_CARRY }],
		['expired', { kind: 'expired', carry: A_CARRY }],
	] as const)('is true when the repository carry is %s', async (_label, read) => {
		read_carry.mockReturnValue(read)

		await expect(run_progress_read.has_run_started([])).resolves.toBe(true)
	})

	it('is false when no lane, hold, or carry records a run', async () => {
		await expect(run_progress_read.has_run_started([])).resolves.toBe(false)
	})
})

describe('read_observations — a run underway with no in-progress child yet', () => {
	// The label is exactly what is missing in this window, so an empty children set is reported as an
	// observation rather than declined — the heartbeat before the first child labels itself.
	it('observes empty children when a lane says a run has started', async () => {
		read_repository.mockResolvedValue({ kind: 'idle' })
		list_lanes.mockResolvedValue([A_LANE_INFO])

		await expect(observe()).resolves.toMatchObject({
			kind: 'observed',
			observations: { children: [] },
		})
	})

	it('observes empty children when the work tree hold says a run has started', async () => {
		read_repository.mockResolvedValue({ kind: 'idle' })
		read_hold.mockReturnValue({ kind: 'held', hold: A_HOLD })

		await expect(observe()).resolves.toMatchObject({
			kind: 'observed',
			observations: { children: [] },
		})
	})

	it('declines as idle when no record and no label says a run is underway', async () => {
		read_repository.mockResolvedValue({ kind: 'idle' })

		await expect(observe()).resolves.toMatchObject({ kind: 'idle' })
	})
})
