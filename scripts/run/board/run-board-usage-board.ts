import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import type { BoardUsage } from './run-board-header'
import { run_board_process_groups } from './run-board-process-groups'
import type { LocalRead } from './run-board-read'
import type { BoardPorts, BoardState } from './run-board-state'
import { run_board_usage, type UsageMark } from './run-board-usage'

// What a reading draws: each lane's CPU/MEM/CMPRS and the 💻 section's groups, both from the same
// differences between this reading and the last. A frame drawn once has no last reading, so it reads
// twice a second apart; otherwise its CPU would be blank.

const PRIME_MS = MS_PER_SECOND

type UsageRead = Pick<BoardState, 'usage' | 'usages'>

function board_usage_of(
	before: UsageMark | undefined,
	after: UsageMark,
	local: LocalRead | undefined,
): BoardUsage {
	const figures = run_board_usage.process_figures(before, after)
	const open_lanes = new Set(local?.lanes.map(Number))
	const roots = local?.roots ?? {}

	return {
		lanes: run_board_usage.usage_of(after, figures),
		processes: run_board_process_groups.groups_of({ mark: after, figures, open_lanes, roots }),
		scale: { cores: after.cores, total_bytes: after.total_bytes },
	}
}

async function primed(state: BoardState, ports: BoardPorts): Promise<UsageMark | undefined> {
	if (ports.is_tty || state.usage !== undefined) return state.usage

	const first = await ports.read_usage(undefined)

	if (first !== undefined) await ports.sleep(PRIME_MS)

	return first
}

// Read on the machine's second; a reading that failed draws no usage but keeps the last reading, so a
// paused lane stays paused through a `ps` timed out under load and the next reading spans the gap.
async function read_usages(state: BoardState, ports: BoardPorts): Promise<UsageRead> {
	const before = await primed(state, ports)
	const usage = await ports.read_usage(before)

	if (usage === undefined) return { usage: before, usages: undefined }

	return { usage, usages: board_usage_of(before, usage, state.local) }
}

const run_board_usage_board = { PRIME_MS, board_usage_of, read_usages }

export { run_board_usage_board }
