import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_app_name } from './run-board-app-name'
import {
	run_board_process_groups,
	type ProcessGroups,
	type ProcessRoots,
} from './run-board-process-groups'
import { run_board_usage, type ProcessReading, type UsageMark } from './run-board-usage'

// joshuafolkken/kit#4171: each process's usage is put under the backlogrun's supervisor, its session,
// an open lane, a closed lane's leftovers or an app — fixed here one attribution at a time.

const { app_of, groups_of } = run_board_process_groups
const LAUNCHD = 1
const SUPERVISOR = 100
const DRIVE = 101
const SESSION = 200
const OPEN_LANE = 4154
const CLOSED_LANE = 4130
const CLAUDE = 'claude'
const ESLINT_D = 'eslint_d - /Users/me/.kit-lanes/4130'
const LEFTOVER_ESLINT = 'eslint_d #4130 ↻'
const ESLINT_PID = 400
const CHROME_APP = 'Google Chrome'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const CHROME_HELPER =
	'/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper'

type Row = readonly [pid: number, parent: number, command: string, memory: number, lane?: number]

// Each row's memory is in bytes, its compressed memory half that.
const ROWS: ReadonlyArray<Row> = [
	[SUPERVISOR, LAUNCHD, 'node', 10],
	[DRIVE, SUPERVISOR, 'node', 20],
	[SESSION, LAUNCHD, CLAUDE, 40],
	[201, SESSION, 'node', 60],
	[300, DRIVE, CLAUDE, 100, OPEN_LANE],
	[301, 300, 'node', 200, OPEN_LANE],
	[ESLINT_PID, LAUNCHD, ESLINT_D, 1000, CLOSED_LANE],
	[500, LAUNCHD, CHROME, 3000],
	[501, 500, CHROME_HELPER, 2000],
	[600, LAUNCHD, CLAUDE, 700],
	[601, LAUNCHD, CLAUDE, 800],
	[602, 601, CLAUDE, 100],
]

function reading_of(memory: number): ProcessReading {
	return { cpu_ms: memory, memory_bytes: memory, compressed_bytes: memory / 2 }
}

function mark_of(rows: ReadonlyArray<Row>): UsageMark {
	return {
		at_ms: 1000,
		processes: new Map(rows.map((row) => [row[0], reading_of(row[3])])),
		lanes: new Map(rows.map((row) => [row[0], row[4] === undefined ? undefined : String(row[4])])),
		names: new Map(rows.map((row) => [row[0], row[2]])),
		parents: new Map(rows.map((row) => [row[0], row[1]])),
		unread: new Set(),
		folded: new Set(),
		cores: 4,
		total_bytes: 100_000,
	}
}

const ROOTS: ProcessRoots = { supervisor: SUPERVISOR, parent: SESSION }
// The closed lanes' records are not ended yet: the supervisor still closes them again.
const CLOSING: ReadonlySet<string> = new Set(['4130', '4154'])

function groups_for(
	roots: ProcessRoots,
	open: ReadonlyArray<number> = [OPEN_LANE],
	stuck: ReadonlyMap<number, string> = new Map(),
	closing: ReadonlySet<string> = CLOSING,
): ProcessGroups {
	const mark = mark_of(ROWS)
	const figures = run_board_usage.process_figures(undefined, mark)

	return groups_of({ mark, figures, open_lanes: new Set(open), roots, stuck, closing })
}

describe('run_board_process_groups.app_of', () => {
	it('names an app by its outermost bundle, else by its command', () => {
		expect(app_of(CHROME_HELPER)).toBe(CHROME_APP)
		expect(app_of(ESLINT_D)).toBe('eslint_d')
	})
})

// joshuafolkken/kit#4263: a redraw over the same process table names no app again.
describe('run_board_process_groups.groups_of over the same table twice', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('names each command once, and none again on the next redraw', () => {
		// An empty table forgets every command an earlier test named.
		groups_of({
			mark: mark_of([]),
			figures: new Map(),
			open_lanes: new Set(),
			roots: ROOTS,
			stuck: new Map(),
			closing: new Set(),
		})
		const naming = vi.spyOn(run_board_app_name, 'app_of')

		groups_for(ROOTS)
		const first = naming.mock.calls.length

		groups_for(ROOTS)

		expect(first).toBeGreaterThan(0)
		expect(first).toBeLessThanOrEqual(new Set(mark_of(ROWS).names.values()).size)
		expect(naming).toHaveBeenCalledTimes(first)
	})
})

describe('run_board_process_groups.groups_of within the backlogrun', () => {
	it('puts the supervisor and its descendants under the supervisor, outside the lanes', () => {
		expect(groups_for(ROOTS).backlogrun.supervisor.memory_bytes).toBe(30)
	})

	it('puts the run’s session and its descendants under the parent', () => {
		expect(groups_for(ROOTS).backlogrun.parent.memory_bytes).toBe(100)
	})

	it('puts a process under an open lane’s directory in the lanes, its ancestry aside', () => {
		const { lanes, total } = groups_for(ROOTS).backlogrun

		expect(lanes).toStrictEqual({
			count: 1,
			figure: { cpu_cores: undefined, memory_bytes: 300, compressed_bytes: 150 },
		})
		expect(total.memory_bytes).toBe(430)
	})

	it('puts a root that is not running among the apps', () => {
		const { backlogrun, apps } = groups_for({})

		expect(backlogrun.total.memory_bytes).toBe(300)
		expect(apps.total.memory_bytes).toBe(6730)
	})
})

describe('run_board_process_groups.groups_of outside the backlogrun', () => {
	it('puts a process under a closed lane’s directory in the leftovers, with its issue number', () => {
		const { leftover } = groups_for(ROOTS)

		expect(leftover.total.memory_bytes).toBe(1000)
		expect(leftover.entries.map((entry) => entry.name)).toStrictEqual([LEFTOVER_ESLINT])
	})

	it('puts everything else under its app, an unrelated Claude session included', () => {
		const { apps } = groups_for(ROOTS)

		expect(apps.total.memory_bytes).toBe(6600)
		expect(apps.top.map(({ name, instances }) => [name, instances])).toStrictEqual([
			[CHROME_APP, 1],
			[CLAUDE, 2],
		])
	})

	it('puts a lane that has closed in the leftovers', () => {
		const { backlogrun, leftover } = groups_for(ROOTS, [])

		expect(backlogrun.lanes.count).toBe(0)
		expect(leftover.entries.map((entry) => entry.name)).toStrictEqual([
			LEFTOVER_ESLINT,
			'node #4154 ↻',
			`${CLAUDE} #4154 ↻`,
		])
	})

	// joshuafolkken/kit#4300: a leftover that outlived a close's SIGKILL is named with why, not as
	// one being reaped.
	it('names a leftover a close could not end with why and its pid', () => {
		const { leftover } = groups_for(ROOTS, [OPEN_LANE], new Map([[ESLINT_PID, 'owned by root']]))

		expect(leftover.entries.map((entry) => entry.name)).toStrictEqual([
			'eslint_d #4130 ⚠ owned by root (pid 400)',
		])
	})

	it('marks no leftover of a lane whose record is ended as being reaped', () => {
		const { leftover } = groups_for(ROOTS, [OPEN_LANE], new Map(), new Set())

		expect(leftover.entries.map((entry) => entry.name)).toStrictEqual(['eslint_d #4130'])
	})
})
