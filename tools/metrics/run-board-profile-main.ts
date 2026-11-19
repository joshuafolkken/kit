#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { core_budget } from '#scripts/gate/core-budget'
import { machine_capacity } from '#scripts/gate/machine-capacity'
import { git_worktree } from '#scripts/git/git-worktree'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import { lane_process_table } from '#scripts/lane/lane-process-table'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_board_cli } from '#scripts/run/board/run-board-cli'
import { run_board_data } from '#scripts/run/board/run-board-data'
import { run_board_data_ports } from '#scripts/run/board/run-board-data-ports'
import { run_board_every } from '#scripts/run/board/run-board-every'
import { run_board_frame_store } from '#scripts/run/board/run-board-frame-store'
import { run_board_gather, type GatherRead } from '#scripts/run/board/run-board-gather'
import { run_board_gather_live } from '#scripts/run/board/run-board-gather-live'
import { run_board_gather_thread } from '#scripts/run/board/run-board-gather-thread'
import { run_board_ledger_window } from '#scripts/run/board/run-board-ledger-window'
import { run_board_read } from '#scripts/run/board/run-board-read'
import { run_board_records } from '#scripts/run/board/run-board-records'
import type { BoardPorts, BoardState } from '#scripts/run/board/run-board-state'
import { run_board_throughput } from '#scripts/run/board/run-board-throughput'
import { run_board_tick } from '#scripts/run/board/run-board-tick'
import { run_board_usage_board } from '#scripts/run/board/run-board-usage-board'
import { run_board_usage_read } from '#scripts/run/board/run-board-usage-read'
import { run_board_usage_top } from '#scripts/run/board/run-board-usage-top'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_tail } from '#scripts/run/event/run-event-tail'
import { run_board_profile, type Piece } from './run-board-profile'

// The measurement #7257 asks for, run by hand in a checkout whose run has started:
// `node --expose-gc --max-semi-space-size=256 --import tsx tools/metrics/run-board-profile-main.ts [runs]`.
// `--expose-gc` lets each read start from a collected heap; the wide young generation keeps a
// collection from landing inside a read, so the heap growth is what the read allocated.

const ARGV_OFFSET = 2
const { LOCAL_READ_MS, MACHINE_SAMPLE_MS } = run_board_gather
const PER_SECOND = MS_PER_MINUTE / MACHINE_SAMPLE_MS
const PER_LOCAL_READ = MS_PER_MINUTE / LOCAL_READ_MS
const PER_TOP = MS_PER_MINUTE / run_board_usage_top.TOP_INTERVAL_MS

// The read the redraws draw from, its frame ports and the state one settled tick left.
interface Settled {
	read: GatherRead
	ports: BoardPorts
	state: BoardState
}

// One read taken beforehand, drawn and written nowhere. The settled tick waits for the GitHub reads,
// so none lands inside a later piece's measurement, and no snapshot store is given, so the live
// board's kept GitHub reads are not rewritten.
async function settled(): Promise<Settled> {
	const live = run_board_gather_live.ports_of(false)
	const read = await run_board_gather.frame_gatherer(live)('background')
	const ports: BoardPorts = {
		...run_board_cli.LIVE_PORTS,
		gather: async () => read,
		// eslint-disable-next-line @typescript-eslint/no-empty-function -- the frame is measured, not shown
		write: () => {},
		snapshot: undefined,
	}
	const state = await run_board_tick.tick(run_board_tick.FRESH_STATE, ports, 'settled')
	// Each redraw after it draws the data as the worker posts it, so no redraw steps it again.
	const posted = { ...read, data: run_board_data.posted(state) }

	return { read: posted, ports: { ...ports, gather: async () => posted }, state }
}

function redraw_piece(ports: BoardPorts, first: BoardState): Piece {
	let state = first

	async function run(): Promise<void> {
		// eslint-disable-next-line require-atomic-updates -- measure_all awaits each run before the next
		state = await run_board_tick.tick(state, ports, 'background')
	}

	return { label: 'redraw', per_minute: PER_SECOND, run }
}

// The redraw on the tick a changed stream reaches: the worker posts a new events array only when its
// re-read differs, and the memos keyed by that array miss on it. Each tick here gets a fresh copy.
function new_events_piece({ read, ports, state }: Settled): Piece {
	const { local } = read

	async function gather(): Promise<GatherRead> {
		return local === undefined ? read : { ...read, local: { ...local, events: [...local.events] } }
	}

	return {
		...redraw_piece({ ...ports, gather }, state),
		label: 'redraw (new events)',
		per_minute: PER_LOCAL_READ,
	}
}

// The extra whole draws the live board's gather worker makes to record the chat's and `--once`'s
// frames (off the main thread), kept in memory rather than in the live board's files.
function record_piece({ ports, state }: Settled): Piece {
	const frames = run_board_frame_store.memory_store()

	return {
		label: 'record (chat + once)',
		per_minute: MS_PER_MINUTE / run_board_every.RECORD_EVERY_MS,
		run: async () => {
			run_board_every.record(state, { ...ports, frames }, undefined, Date.now())
		},
	}
}

function redraw_pieces(from: Settled): Array<Piece> {
	return [redraw_piece(from.ports, from.state), new_events_piece(from), record_piece(from)]
}

// One worker round, the whole of what the live board reads each second, with the GitHub, roster and
// snapshot data stepped over it as the worker steps it. The rounds run back to back,
// so the round's clock is moved a second per round: the local read then falls due on every fifth
// round, as on the live board, rather than once in the whole measurement.
function round_piece(): Piece {
	const clock = { ms: Date.now() }
	const live = { ...run_board_gather_live.ports_of(true), ...run_board_data_ports.live() }
	const ports = { ...live, now: () => clock.ms }
	let state = run_board_gather_thread.first_round()

	async function run(): Promise<void> {
		// eslint-disable-next-line require-atomic-updates -- measure_all awaits each run before the next
		state = await run_board_gather_thread.gather_round(state, ports, () => {
			// The round is measured, not handed to a board.
		})
		clock.ms += MACHINE_SAMPLE_MS
	}

	return { label: 'gather round (all reads)', per_minute: PER_SECOND, run, role: 'whole' }
}

// The usage fold a round makes, carried round to round as `resample` carries it, with one `ps` per
// round shared by its askers; one set of ports keeps the held `top` reading between rounds.
function usages_piece(): Piece {
	const ports = run_board_gather_live.ports_of(true)
	let state = run_board_gather.FRESH_GATHER

	async function run(): Promise<void> {
		const table = lane_process_table.shared(ports.read_table)

		// eslint-disable-next-line require-atomic-updates -- measure_all awaits each run before the next
		state = { ...state, ...(await run_board_usage_board.read_usages(state, ports, table)) }
	}

	return { label: 'usages', per_minute: PER_SECOND, run, role: 'part' }
}

// The reads a round makes each second besides the machine sample (#8136).
function round_part_pieces(): Array<Piece> {
	const { read_quotas } = run_board_gather_live.ports_of(true)

	return [
		{
			label: 'budget waits',
			per_minute: PER_SECOND,
			run: async () => core_budget.budget_waits(),
			role: 'part',
		},
		{
			label: 'quotas',
			per_minute: PER_SECOND,
			run: async () => await read_quotas?.(),
			role: 'part',
		},
		usages_piece(),
	]
}

function machine_pieces(): Array<Piece> {
	const read_usage = run_board_usage_read.usage_reader()
	const { read_table } = lane_process_table

	return [
		{ label: 'sysctl', per_minute: PER_SECOND, run: machine_capacity.read_sample, role: 'part' },
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

// The two shares of `read_local` #7257 found heaviest, each called as `read_local` calls it, and the
// ledger read (#8136); the throughput fold is given one stream read taken beforehand, so the fold alone
// is measured.
function local_share_pieces(repository: string): Array<Piece> {
	const events = run_event_tail.read_events(run_event_stream.target_of(repository))
	const ledger = lane_ledger.target_of(repository)

	return [
		{
			label: 'ledger',
			per_minute: PER_LOCAL_READ,
			run: async () => run_board_ledger_window.entries_of(ledger, Date.now()),
		},
		{
			label: 'lane records read',
			per_minute: PER_LOCAL_READ,
			run: async () => run_board_records.read_records(repository),
		},
		{
			label: 'throughput fold',
			per_minute: PER_LOCAL_READ,
			run: async () => run_board_throughput.rows_of(events, Date.now()),
		},
	]
}

function local_pieces(repository: string): Array<Piece> {
	const target = run_event_stream.target_of(repository)

	return [
		...local_share_pieces(repository),
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
			role: 'part',
		},
	]
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	const runs = run_board_profile.runs_of(argv[0])
	const repository = await run_carry.repository_directory()
	const local = repository === undefined ? [] : local_pieces(repository)
	const pieces = [
		...redraw_pieces(await settled()),
		round_piece(),
		...machine_pieces(),
		...round_part_pieces(),
		...local,
	]
	const samples = await run_board_profile.measure_all(pieces, runs, run_board_profile.LIVE_PORTS)

	process.stdout.write(`${run_board_profile.format(samples)}\n`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

const run_board_profile_main = { local_pieces, machine_pieces, redraw_pieces, round_part_pieces }

export { run_board_profile_main }
