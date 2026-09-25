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
import { PACKAGE_DIR } from '#scripts/init/init-paths'
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
	// Raised in joshuafolkken/kit#2289 when `pre-gate-cut.md` joined the point-of-use set: its ~29KB
	// read is a point-of-use read every entry's total now counts, a correction of an under-count rather
	// than new reading. Raised again in joshuafolkken/kit#2282 when the same document grew by its
	// status-quo decision record, and once more in joshuafolkken/kit#2295 when it recorded the
	// recent-context hand-off. Lowered in joshuafolkken/kit#2294 — the FIRST downward move on this
	// ratchet — when `pre-gate-cut.md` was compressed (37,786 B → ~20,300 B): every entry that reads it
	// crossed a block downward, so the recorded ceilings drop to the block multiples the stale-ratchet
	// message named rather than staying loose above the reduction. `kickoff` and the lane child rose one
	// block again in joshuafolkken/kit#2312 when `pre-gate-cut.md` recorded the resume-side cost the
	// conditional cut is built on; the other entries stayed within their block. `backlogrun` rose one
	// block in joshuafolkken/kit#2317 when `backlogrun-child.md`'s outage section recorded the
	// session-resume re-dispatch and the outage-fold window.
	// Raised in joshuafolkken/kit#2328 when `retrospective.md` joined the point-of-use set and `SKILL.md`
	// grew by §2j: every entry that reads `SKILL.md` discovers the retrospective document, so its ~5KB
	// and the new section crossed a block for each. The lane child is exempt — it never runs the
	// retrospective (`run:step` answers `stop` for a child at the stop position), so it skips both.
	// joshuafolkken/kit#2335 recorded the drain-time firing with the operational detail in
	// `retrospective.md` (which the lane child skips) and a one-line pointer in `backlogrun-steps.md`, so
	// every entry stayed within its block rather than climbing back to a pre-#2294 ceiling the downward
	// ratchet holds shut. joshuafolkken/kit#2342 added the `--summary` close to `retrospective.md` in a
	// single sentence, kept short so every entry that reads it stays within its block.
	// Lowered for the lane child in joshuafolkken/kit#2357 — a downward move on this ratchet — when
	// `backlogrun-steps.md` left the child's point-of-use set: the child never opened the scheduler's step
	// list, so its ~48KB read crossed a block downward and the recorded ceiling drops to the block multiple
	// the stale-ratchet message named. The other entries still read it, so their rows hold.
	// joshuafolkken/kit#2345 added the `implementation-unit` delegation row (full fan-out procedure in
	// `docs/josh-commands.md` → "`josh fanout`"); `SKILL.md` §2b gained only a one-clause mention and a
	// pointer, folded into the existing enumeration and offset by tightening §2b prose, so every entry
	// stayed within its block (kickoff has no block of headroom — its pre-#2294 ceiling is the next
	// multiple, which the downward ratchet holds shut).
	// joshuafolkken/kit#2353 wired the watcher-guard note into `backlogrun-progress.md` (read by the three
	// planning entries): kickoff has no headroom, so the addition was offset by tightening that file's
	// heartbeat prose, keeping every entry within its existing block.
	{ entry: 'kickoff', bytes: 258_048 },
	{ entry: 'fullrun', bytes: 258_048 },
	{ entry: 'halfrun', bytes: 258_048 },
	{ entry: 'backlogrun', bytes: 262_144 },
	{ entry: LANE_CHILD, bytes: 86_016 },
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

function resident_base_bytes(): number {
	return document_reachability.RESIDENT_BASE.reduce(
		(sum, one) => sum + byte_size(PACKAGE_DIR, one),
		NOTHING,
	)
}

// The bytes an entry's mandated read comes to right now — what the recorded ceiling is compared
// against.
function entry_total_bytes(root: string, entry: string): number {
	return total_read_bytes(entry_cost(root, entry)) + resident_base_bytes()
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
