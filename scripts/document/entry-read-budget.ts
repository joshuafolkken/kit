// The byte ceiling on what each workflow entry reads before it starts — the primary budget, a
// ratchet like the per-document one (joshuafolkken/kit#2257).
//
// **The per-document ceiling was a proxy for a run's cost, not the cost.** A run does not pay "one
// document's size"; it pays the total its entry reads — the mandated skill files, the sections they
// point out to, the point-of-use documents reached later, and the resident `CLAUDE.md` every request
// carries. `read:set` already computes that total, so this budgets it directly: the entry total is
// the primary ceiling, and the per-document ceiling (`document-byte-budget.ts`) falls back to the
// documents no entry reads (`document-reachability.ts` draws the line). A document an entry reads is
// held by the entry total and carries no per-document ceiling, so neither budget holds it twice.
//
// THE CEILING IS BLOCK-QUANTIZED, exactly as the per-document one is (joshuafolkken/kit#2231): an
// entry total is one number, so recording its raw size would make every lane that nudges a covered
// document bump this shared line. The recorded ceiling is the smallest `BLOCK_BYTES` multiple at or
// above the measured total, so growth within a block needs no edit and a crossing bumps to the same
// multiple from every lane — the change git auto-merges.
//
// HOW TO RAISE (or LOWER) A CEILING — this file, like the per-document budget. When the gate reports
// an entry over its ceiling, copy the exact value the message names into that entry's row. A
// reduction that drops the total below a block lowers the row the same way, to the multiple the
// stale message names.

import { statSync } from 'node:fs'
import path from 'node:path'
import { backlogrun_parent_read_set } from './backlogrun-parent-read-set'
import { document_byte_budget } from './document-byte-budget'
import { document_reachability } from './document-reachability'
import { entry_read_set, type ReadSetCost } from './entry-read-set'
import { lane_child_read_set } from './lane-child-read-set'

const { block_ceiling } = document_byte_budget
const { LANE_CHILD } = lane_child_read_set
const { BACKLOGRUN } = backlogrun_parent_read_set
const NOTHING = 0

interface EntryBudget {
	entry: string
	bytes: number
}

// Recorded byte ceiling of each entry's total read — the block multiple at or above its measured
// size. Names exactly the entries `known_entries` offers: the test fails on a stale entry and on an
// entry with no row, so the definition cannot rot as entries are added or removed.
const ENTRY_READ_BUDGET: ReadonlyArray<EntryBudget> = [
	{ entry: 'kickoff', bytes: 233_472 },
	{ entry: 'fullrun', bytes: 233_472 },
	{ entry: 'halfrun', bytes: 233_472 },
	{ entry: 'backlogrun', bytes: 237_568 },
	{ entry: LANE_CHILD, bytes: 106_496 },
]

function byte_size(root: string, relative_path: string): number {
	return statSync(path.join(root, relative_path)).size
}

function entry_cost(root: string, entry: string): ReadSetCost {
	if (entry === LANE_CHILD) return lane_child_read_set.costed(root)

	if (entry === BACKLOGRUN) return backlogrun_parent_read_set.costed(root)

	return entry_read_set.costed(root, entry)
}

// The total an entry reads, in bytes: its scoped own files plus the point-of-use sections it reaches
// later — the same figure `josh read:set` prints as `total read` — plus the resident base every entry
// carries whatever it does.
function total_read_bytes(cost: ReadSetCost): number {
	return entry_read_set.total([cost.scoped, ...cost.point_of_use.map((one) => one.cost)]).bytes
}

function resident_base_bytes(root: string): number {
	return document_reachability.RESIDENT_BASE.reduce(
		(sum, one) => sum + byte_size(root, one),
		NOTHING,
	)
}

// The bytes an entry's mandated read comes to right now — what the recorded ceiling is compared
// against.
function entry_total_bytes(root: string, entry: string): number {
	return total_read_bytes(entry_cost(root, entry)) + resident_base_bytes(root)
}

function recorded_bytes_for(entry: string): number | undefined {
	return ENTRY_READ_BUDGET.find((one) => one.entry === entry)?.bytes
}

// The over-budget message, naming the entry, its current total, its recorded ceiling, and the next
// block multiple to record — the same shape the per-document budget uses so a reader raises a ceiling
// by copying rather than computing.
function over_budget_message(entry: string, current_bytes: number, recorded_bytes: number): string {
	const next = block_ceiling(current_bytes).toString()
	const raise_hint = `raise its recorded size to ${next} in scripts/document/entry-read-budget.ts so the reason shows in the PR diff`

	return `entry ${entry} reads ${current_bytes.toString()} bytes, over its ${recorded_bytes.toString()}-byte ceiling. Trim what it reads, or ${raise_hint}.`
}

// The stale-ratchet message: a recorded ceiling more than a block above the entry's actual total was
// left loose when the read shrank across a boundary, so it no longer holds the reduction.
function stale_budget_message(
	entry: string,
	recorded_bytes: number,
	current_bytes: number,
): string {
	const next = block_ceiling(current_bytes).toString()
	const lower_hint = `lower its recorded size to ${next} in scripts/document/entry-read-budget.ts so the ratchet holds the reduction`

	return `entry ${entry} records ${recorded_bytes.toString()} bytes but reads ${current_bytes.toString()}, more than a block above actual. ${lower_hint}.`
}

const entry_read_budget = {
	ENTRY_READ_BUDGET,
	entry_total_bytes,
	over_budget_message,
	recorded_bytes_for,
	stale_budget_message,
}

export type { EntryBudget }
export { entry_read_budget }
