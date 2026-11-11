#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { machine_capacity } from '#scripts/gate/machine-capacity'
import { git_worktree } from '#scripts/git/git-worktree'
import { lane_process_table } from '#scripts/lane/lane-process-table'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_board_cli } from '#scripts/run/board/run-board-cli'
import { run_board_gather } from '#scripts/run/board/run-board-gather'
import { run_board_gather_live } from '#scripts/run/board/run-board-gather-live'
import { run_board_read } from '#scripts/run/board/run-board-read'
import { run_board_tick } from '#scripts/run/board/run-board-tick'
import { run_board_usage_read } from '#scripts/run/board/run-board-usage-read'
import { run_board_usage_top } from '#scripts/run/board/run-board-usage-top'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_board_profile, type Piece, type ProfilePorts } from './run-board-profile'

// The measurement #7257 asks for, run by hand in a checkout whose run has started:
// `node --expose-gc --max-semi-space-size=256 --import tsx tools/metrics/run-board-profile-main.ts [runs]`.
// `--expose-gc` lets each read start from a collected heap; the wide young generation keeps a
// collection from landing inside a read, so the heap growth is what the read allocated.

const ARGV_OFFSET = 2
const DEFAULT_RUNS = 20
const US_PER_MS = 1000
const { LOCAL_READ_MS, MACHINE_SAMPLE_MS } = run_board_gather
const PER_SECOND = MS_PER_MINUTE / MACHINE_SAMPLE_MS
const PER_LOCAL_READ = MS_PER_MINUTE / LOCAL_READ_MS
const PER_TOP = MS_PER_MINUTE / run_board_usage_top.TOP_INTERVAL_MS

const LIVE: ProfilePorts = {
	now: () => performance.now(),
	cpu_ms: () => {
		const { user, system } = process.cpuUsage()

		return (user + system) / US_PER_MS
	},
	heap_bytes: () => {
		const usage = process.memoryUsage()

		return usage.heapUsed + usage.external
	},
	// A no-op where the process was started without `--expose-gc`.
	settle: () => {
		globalThis.gc?.()
	},
}

// The redraw alone: the frame is drawn from one read taken beforehand, and written nowhere.
async function redraw_piece(): Promise<Piece> {
	const live = run_board_gather_live.ports_of(false)
	const read = await run_board_gather.frame_gatherer(live)('background')
	// eslint-disable-next-line @typescript-eslint/no-empty-function -- the frame is measured, not shown
	const ports = { ...run_board_cli.LIVE_PORTS, gather: async () => read, write: () => {} }
	let state = run_board_tick.FRESH_STATE

	async function run(): Promise<void> {
		// eslint-disable-next-line require-atomic-updates -- measure_all awaits each run before the next
		state = await run_board_tick.tick(state, ports, 'background')
	}

	return { label: 'redraw', per_minute: PER_SECOND, run }
}

// One worker round, the whole of what the live board reads each second.
function round_piece(): Piece {
	const ports = run_board_gather_live.ports_of(true)
	let state = run_board_gather.FRESH_GATHER

	async function run(): Promise<void> {
		// eslint-disable-next-line require-atomic-updates -- measure_all awaits each run before the next
		state = await run_board_gather.gather(state, ports, 'background')
	}

	return { label: 'gather round (all reads)', per_minute: PER_SECOND, run }
}

function machine_pieces(): Array<Piece> {
	const read_usage = run_board_usage_read.usage_reader()
	const { read_table } = lane_process_table

	return [
		{ label: 'sysctl', per_minute: PER_SECOND, run: machine_capacity.read_sample },
		{ label: 'ps', per_minute: PER_SECOND, run: read_table },
		{
			label: 'usage (ps + top held)',
			per_minute: PER_SECOND,
			run: async () => await read_usage(undefined, read_table),
		},
		{
			label: 'top',
			per_minute: PER_TOP,
			run: async () => run_board_usage_top.parse_top(await run_board_usage_top.list_top()),
		},
	]
}

function local_pieces(repository: string): Array<Piece> {
	const target = run_event_stream.target_of(repository)

	return [
		{
			label: 'stream re-parse',
			per_minute: PER_LOCAL_READ,
			run: async () => run_event_stream.read_events(target),
		},
		{ label: 'git worktree list', per_minute: PER_LOCAL_READ, run: git_worktree.worktree_list },
		{
			label: 'local read (stream + git + lanes)',
			per_minute: PER_LOCAL_READ,
			// One `ps` shared by the read's askers, as a gather round shares it.
			run: async () =>
				await run_board_read.read_local(lane_process_table.shared(lane_process_table.read_table)),
		},
	]
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	const runs = Number(argv[0] ?? DEFAULT_RUNS)
	const repository = await run_carry.repository_directory()
	const local = repository === undefined ? [] : local_pieces(repository)
	const pieces = [await redraw_piece(), round_piece(), ...machine_pieces(), ...local]
	const samples = await run_board_profile.measure_all(pieces, runs, LIVE)

	process.stdout.write(`${run_board_profile.format(samples)}\n`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))
