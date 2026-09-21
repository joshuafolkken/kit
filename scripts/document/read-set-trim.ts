// Trimming a base entry's read set by role (joshuafolkken/kit#2256).
//
// **A dispatched lane child (the worker) and a `backlogrun` parent (the scheduler) both read a trimmed
// version of a base entry.** The worker trims `fullrun` (`lane-child-read-set.ts`); the parent trims
// `backlogrun` (`backlogrun-parent-read-set.ts`). Both do the same two things: the `SKILL.md` sections
// that role never uses are read at the section level rather than whole, and — where the role owns no
// point-of-use document — those are dropped too. This is the one mechanism the two derivations share,
// single-sourced here rather than cloned; each supplies its own base entry, label, unused sections and
// skipped point-of-use set.
//
// **Deriving off the base entry's own figures keeps each honest** — a row that moves in the base set
// moves here with it — and leaves the whole of `entry-read-set.ts` untouched (joshuafolkken/kit#2021
// decided this against reshaping `SKILL.md` itself, which every entry point would have paid for).

import { document_section } from './document-section'
import { entry_read_set, type Cost, type FileCost, type ReadSetCost } from './entry-read-set'

interface TrimSpec {
	// The table entry whose read set is trimmed — `fullrun` for the worker, `backlogrun` for the parent.
	base_entry: string
	// The label the trimmed set reports as; `lane-child` for the worker, `backlogrun` for the parent.
	label: string
	// The `SKILL.md` sections this role never uses, read at the section level rather than in full.
	unused_skill_sections: ReadonlyArray<string>
	// The point-of-use documents this role's parent owns; empty when the role owns them all.
	skipped_point_of_use: ReadonlySet<string>
}

function subtract(left: Cost, right: Cost): Cost {
	return { bytes: left.bytes - right.bytes, tokens: left.tokens - right.tokens }
}

function skill_text(root: string): string {
	const path = entry_read_set.document_path(root, entry_read_set.SKILL_FILE)

	return document_section.read_optional(path) ?? ''
}

// An unresolved heading is charged at zero rather than at its whole file: unlike the entry read's own
// section measurement, a miss here would *under*-count the trim, so each derivation's test pins that
// its sections resolve and this stays a safe fallback rather than the expected path.
function section_cost(text: string, heading: string): Cost {
	return entry_read_set.cost_of(document_section.section(text, heading)?.text ?? '')
}

function unused_skill_cost(root: string, sections: ReadonlyArray<string>): Cost {
	const text = skill_text(root)

	return entry_read_set.total(sections.map((heading) => section_cost(text, heading)))
}

// The saving lands entirely on the `SKILL.md` row, so every other file is returned unchanged.
function reduce_skill(file: FileCost, saving: Cost): FileCost {
	if (file.file !== entry_read_set.SKILL_FILE) return file

	return { file: file.file, cost: subtract(file.cost, saving) }
}

// **`whole` and `scoped` both carry the own-files cost identically**, so the `SKILL.md` saving lands
// on each by the same amount — there is no need to re-derive the referenced-section split.
function costed(root: string, spec: TrimSpec): ReadSetCost {
	const base = entry_read_set.costed(root, spec.base_entry)
	const saving = unused_skill_cost(root, spec.unused_skill_sections)

	return {
		...base,
		entry: spec.label,
		files: base.files.map((file) => reduce_skill(file, saving)),
		point_of_use: base.point_of_use.filter((one) => !spec.skipped_point_of_use.has(one.file)),
		whole: subtract(base.whole, saving),
		scoped: subtract(base.scoped, saving),
	}
}

const read_set_trim = { costed, unused_skill_cost }

export type { TrimSpec }
export { read_set_trim }
