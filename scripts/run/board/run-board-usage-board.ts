import type { TableRead } from '#scripts/lane/lane-process-table'
import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import type { GatherPorts, GatherState } from './run-board-gather'
import type { BoardUsage } from './run-board-header'
import { run_board_process_groups } from './run-board-process-groups'
import type { LocalRead } from './run-board-read'
import { run_board_usage, type UsageMark } from './run-board-usage'

// What a reading draws: each lane's CPU/MEM/CMPRS and the 💻 section's groups, both from the same
// differences between this reading and the last. A frame drawn once has no last reading, so it reads
// twice a second apart; otherwise its CPU would be blank.

const PRIME_MS = MS_PER_SECOND

type UsageRead = Pick<GatherState, 'usage' | 'usages'>

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

// A primed frame's two readings each take a snapshot of their own: the redraw's was taken before the
// lane read's confirmation wait and the GitHub reads, so it would stretch the first second.
async function primed(
	state: GatherState,
	ports: GatherPorts,
	table: TableRead,
): Promise<{ before: UsageMark | undefined; table: TableRead }> {
	if (ports.is_live || state.usage !== undefined) return { before: state.usage, table }

	const first = await ports.read_usage(undefined, ports.read_table)

	if (first !== undefined) await ports.sleep(PRIME_MS)

	return { before: first, table: ports.read_table }
}

// Read on the machine's second; a reading that failed draws no usage but keeps the last reading, so the
// next reading after a `ps` timed out under load spans the gap.
async function read_usages(
	state: GatherState,
	ports: GatherPorts,
	table: TableRead,
): Promise<UsageRead> {
	const primer = await primed(state, ports, table)
	const { before } = primer
	const usage = await ports.read_usage(before, primer.table)

	if (usage === undefined) return { usage: before, usages: undefined }

	return { usage, usages: board_usage_of(before, usage, state.local) }
}

const run_board_usage_board = { PRIME_MS, board_usage_of, read_usages }

export { run_board_usage_board }
