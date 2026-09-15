// What a dispatched lane child reads, and what that costs (joshuafolkken/kit#2021).
//
// **A lane child is the largest fixed cost a `backlogrun` has.** Measured on the batch of
// 2026-09-13, the lane child sessions were 72% of the run's whole input (joshuafolkken/kit#1936),
// and each `claude -p fullrun #N` child read the `fullrun` entry set in full — around 227KB. Most of
// that is spent on procedure a leaf child never carries out: it dispatches no child of its own, opens
// no lane, runs no progress watcher and performs no hand-off, so the point-of-use documents that
// carry those steps are read by the parent and never by the child.
//
// **This models the child as a trimmed `fullrun`, derived rather than transcribed.** The set is the
// `fullrun` entry read (`entry_read_set.costed(root, 'fullrun')`) with two subtractions: the
// `SKILL.md` sections a child never uses are read at the section level rather than whole, and the
// point-of-use documents a leaf never reaches are dropped. Building it off `fullrun`'s own figures
// keeps it honest — a row that moves in `fullrun`'s set moves here with it — and keeps the whole of
// `entry-read-set.ts` untouched (joshuafolkken/kit#2021 decided this against reshaping `SKILL.md`
// itself, which every entry point would have paid for).

import { document_section } from './document-section'
import { entry_read_set, type Cost, type FileCost, type ReadSetCost } from './entry-read-set'

const LANE_CHILD = 'lane-child'
const FULLRUN = 'fullrun'

// **The `SKILL.md` sections a dispatched lane child never uses**, read at the section level rather
// than in full. A child is handed one issue to run, so it never files a new one with an `into`
// target (§2a), never names a repository or scouts for a duplicate at its entry (§2c, §2e), returns
// an observation to the parent rather than filing it (§2i, `SKILL.md` → §2i), and never edits these
// documents, so the residency meta-guidance (§3) is not procedure it acts on. The headings are the
// text after `## `, exactly as `document_section` resolves them.
const UNUSED_SKILL_SECTIONS: ReadonlyArray<string> = [
	'2a. The `into <target>` suffix — where the new Issue lands',
	'2c. The `owner/repo#` prefix — which repository the run acts on',
	'2e. Before filing a new Issue — `pnpm josh issue:scout`',
	'2i. An observation worth filing is filed without asking',
	'3. What stays resident, and what is read from here',
]

// **The point-of-use documents a leaf child never reaches**: child dispatch, lane opening and the
// progress watcher / hand-off are the parent's, so their single-source documents are dropped from
// the child's read. The gate documents (`chain-rule.md`, `background-commands.md`), `followup.md`,
// `latest-gate.md` and `backlogrun-park.md` stay — a child runs the gate, opens its PR, and may park
// on a decision, so it does reach every one of those.
const SKIPPED_POINT_OF_USE: ReadonlySet<string> = new Set([
	'backlogrun-child.md',
	'backlogrun-lanes.md',
	'backlogrun-progress.md',
])

function subtract(left: Cost, right: Cost): Cost {
	return { bytes: left.bytes - right.bytes, tokens: left.tokens - right.tokens }
}

function skill_text(root: string): string {
	const path = entry_read_set.document_path(root, entry_read_set.SKILL_FILE)

	return document_section.read_optional(path) ?? ''
}

// An unresolved heading is charged at zero rather than at its whole file: unlike the entry read's own
// section measurement, a miss here would *under*-count the child, so the test pins that all five
// resolve and this stays a safe fallback rather than the expected path.
function section_cost(text: string, heading: string): Cost {
	return entry_read_set.cost_of(document_section.section(text, heading)?.text ?? '')
}

function unused_skill_cost(root: string): Cost {
	const text = skill_text(root)

	return entry_read_set.total(UNUSED_SKILL_SECTIONS.map((heading) => section_cost(text, heading)))
}

// The saving lands entirely on the `SKILL.md` row, so every other file is returned unchanged.
function reduce_skill(file: FileCost, saving: Cost): FileCost {
	if (file.file !== entry_read_set.SKILL_FILE) return file

	return { file: file.file, cost: subtract(file.cost, saving) }
}

// **`whole` and `scoped` both carry the own-files cost identically**, so the `SKILL.md` saving lands
// on each by the same amount — there is no need to re-derive the referenced-section split.
function costed(root: string): ReadSetCost {
	const base = entry_read_set.costed(root, FULLRUN)
	const saving = unused_skill_cost(root)

	return {
		...base,
		entry: LANE_CHILD,
		files: base.files.map((file) => reduce_skill(file, saving)),
		point_of_use: base.point_of_use.filter((one) => !SKIPPED_POINT_OF_USE.has(one.file)),
		whole: subtract(base.whole, saving),
		scoped: subtract(base.scoped, saving),
	}
}

const lane_child_read_set = {
	LANE_CHILD,
	SKIPPED_POINT_OF_USE,
	UNUSED_SKILL_SECTIONS,
	costed,
	unused_skill_cost,
}

export { lane_child_read_set }
