import { core_admission, type LedgerEntry } from './core-admission'
import type { MachineBudget } from './machine-capacity'

// **Why a claim waits, and who is waiting** (joshuafolkken/kit#3943). A claim held back by the budget
// used to wait in silence: the command printed nothing and no board showed it, so a lane stalled on
// memory pressure read the same as one stuck. The waiting claim records its reason on its marker and
// says it once on its own output; `run:board` draws every marker still waiting. Everything here is a
// pure function of the ledger and the budget it is handed.

const WAIT_REASONS = ['cores', 'memory', 'pressure'] as const

type WaitReason = (typeof WAIT_REASONS)[number]

// The one wording of each reason, shared by the waiting command's line and the board's.
const REASON_TEXT: Record<WaitReason, string> = {
	cores: 'not enough free cores',
	memory: 'not enough free memory',
	pressure: 'memory under pressure',
}

// What the board reads off a marker. Every field but the claim time is optional, so a marker an older
// `josh` wrote still reads, and one that never waited is not drawn.
interface WaitMarker {
	claimed_at: number
	admitted_at?: number | undefined
	command?: string | undefined
	lane?: string | undefined
	wait_reason?: WaitReason | undefined
}

interface BudgetWait {
	command: string | undefined
	lane: string | undefined
	waited_ms: number
	reason: WaitReason
}

// **The cores decide first**: a claim that would not fit even with unlimited memory waits for cores;
// one that fits on cores waits for memory, named as pressure when the reading saw compression or swap.
function wait_reason(
	key: string,
	reservations: ReadonlyArray<LedgerEntry>,
	budget: MachineBudget,
): WaitReason {
	const cores_only = { cores: budget.cores, memory_mb: Infinity }

	if (!core_admission.is_admitted(key, reservations, cores_only)) return 'cores'

	return budget.memory_pressured === true ? 'pressure' : 'memory'
}

// The line a waiting command prints once, when its wait starts.
function wait_line(command: string | undefined, reason: WaitReason): string {
	return `⏳ ${command ?? 'a step'} waits for the core budget — ${REASON_TEXT[reason]}`
}

function wait_of(marker: WaitMarker, now: number): Array<BudgetWait> {
	const { command, lane, wait_reason: reason } = marker

	if (reason === undefined || marker.admitted_at !== undefined) return []

	return [{ command, lane, waited_ms: now - marker.claimed_at, reason }]
}

// The claims still waiting, longest first.
function waits_of(
	entries: ReadonlyArray<{ reservation: WaitMarker }>,
	now: number,
): Array<BudgetWait> {
	return entries
		.flatMap((entry) => wait_of(entry.reservation, now))
		.toSorted((left, right) => right.waited_ms - left.waited_ms)
}

const core_wait = {
	REASON_TEXT,
	WAIT_REASONS,
	wait_line,
	wait_reason,
	waits_of,
}

export type { BudgetWait, WaitReason }
export { core_wait }
