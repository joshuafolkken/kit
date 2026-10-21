import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { session_cite } from '#scripts/issue/session-cite'
import { stamp_file } from '#scripts/josh/stamp-file'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableProbes } from './lane-process-table'
import { lane_reap } from './lane-reap'
import type { LaneInfo } from './lane-registry'
import { lane_state } from './lane-state'
import { lane_state_cli } from './lane-state-cli'

// joshuafolkken/kit#4268: `josh lane:state --backfill` gives every lane opened before the record existed
// a record read off what the lane is doing now, and leaves a lane that already has one as it is.

const PAUSED = '4101'
const RUNNING = '4102'
const IDLE = '4103'
const ISSUES = [PAUSED, RUNNING, IDLE]
const DISPATCHED_MS = Date.parse('2026-10-20T02:00:00.000Z')
const PAUSED_PID = 101
const RUNNING_PID = 102
const STOPPED_STAT = 'T'
const RUNNING_STAT = 'S'
const ZOMBIE_STAT = 'Z'
const FAILURE = 1

const TREES: Record<string, Array<number>> = { [PAUSED]: [PAUSED_PID], [RUNNING]: [RUNNING_PID] }

const PROBES: TableProbes = {
	matching: () => [],
	children_of: () => [],
	parent_of: () => undefined,
	states_of: (pids) => pids.map((pid) => (pid === PAUSED_PID ? STOPPED_STAT : RUNNING_STAT)),
}

const state = { directory: '' }

function lane_of(issue: string): LaneInfo {
	return {
		issue,
		branch: `${issue}-lane`,
		directory: path.join(state.directory, issue),
		seat: 1,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		is_stranded: false,
		dispatched_ms: DISPATCHED_MS,
	}
}

beforeEach(() => {
	state.directory = mkdtempSync(path.join(tmpdir(), 'lane-state-cli-'))
	vi.spyOn(lane_reap, 'lane_tree').mockImplementation((issue) => TREES[issue] ?? [])
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
	for (const issue of ISSUES) stamp_file.remove_stamp(lane_state.state_path(state.directory, issue))
	rmSync(state.directory, { recursive: true, force: true })
	vi.restoreAllMocks()
})

describe('lane_state_cli.backfill — the state read off the lane', () => {
	it('records a stopped child paused, a live one running and a childless lane open', async () => {
		const lanes = ISSUES.map((issue) => lane_of(issue))

		await lane_state_cli.backfill(lanes, PROBES, state.directory)

		const records = await Promise.all(
			ISSUES.map(async (issue) => await lane_state.read_state(issue, state.directory)),
		)

		expect(records.map((record) => record?.state)).toStrictEqual(['paused', 'running', 'open'])
	})

	it('stamps a live child with its dispatch time and an idle lane with none', async () => {
		await lane_state_cli.backfill([lane_of(RUNNING), lane_of(IDLE)], PROBES, state.directory)

		expect(await lane_state.read_state(RUNNING, state.directory)).toMatchObject({
			launched_at: new Date(DISPATCHED_MS).toISOString(),
		})
		expect(await lane_state.read_state(IDLE, state.directory)).not.toHaveProperty('launched_at')
	})
})

// joshuafolkken/kit#4270: the `ps` read of a paused lane is the backfill's alone now — a zombie stops
// nothing, and one running subprocess keeps the lane running.
describe('lane_state_cli.backfill — a lane with a subprocess', () => {
	const CHILD_PID = 201
	const SUBPROCESS_PID = 202

	async function backfilled(subprocess_stat: string): Promise<string | undefined> {
		vi.mocked(lane_reap.lane_tree).mockReturnValue([CHILD_PID, SUBPROCESS_PID])

		const probes: TableProbes = {
			...PROBES,
			states_of: (pids) => pids.map((pid) => (pid === CHILD_PID ? STOPPED_STAT : subprocess_stat)),
		}

		await lane_state_cli.backfill([lane_of(PAUSED)], probes, state.directory)

		const record = await lane_state.read_state(PAUSED, state.directory)

		return record?.state
	}

	it('records a stopped child whose subprocess is a zombie paused', async () => {
		expect(await backfilled(ZOMBIE_STAT)).toBe('paused')
	})

	it('records a stopped child whose subprocess still runs running', async () => {
		expect(await backfilled(RUNNING_STAT)).toBe('running')
	})
})

describe('lane_state_cli.backfill — a lane that already has a record', () => {
	it('keeps the existing record and says so', async () => {
		await lane_state.record_change(
			{ issue: RUNNING, state: 'ended', command: 'lane:close' },
			{ directory: state.directory },
		)

		const lines = await lane_state_cli.backfill([lane_of(RUNNING)], PROBES, state.directory)

		expect(lines).toStrictEqual([
			`lane:state --backfill ${session_cite.issue(RUNNING)}: kept its ended record`,
		])
		expect(await lane_state.read_state(RUNNING, state.directory)).toMatchObject({ state: 'ended' })
	})
})

describe('lane_state_cli.run — the usage', () => {
	it.each([[[]], [['--all']], [['--backfill', IDLE]]])(
		'refuses %j with the usage line',
		async (argv) => {
			expect(await lane_state_cli.run(argv)).toBe(FAILURE)
			expect(console.error).toHaveBeenCalledWith('Usage: josh lane:state --backfill')
		},
	)
})
