import { describe, expect, it } from 'vitest'
import { backlogrun_parent_read_set } from './backlogrun-parent-read-set'
import { document_section } from './document-section'
import { entry_read_set } from './entry-read-set'
import { lane_child_read_set } from './lane-child-read-set'

// joshuafolkken/kit#2256. The `backlogrun` parent reads a trimmed set the way the lane child does:
// the `SKILL.md` sections only an implementing entry uses are read at the section level, not whole.
// What is pinned here is that the trim is real and derived — built off `backlogrun`'s own entry
// figures — and, above all, that the parent does not drop a section it actually needs.

const ROOT = process.cwd()
const BACKLOGRUN = 'backlogrun'
const NOTHING = 0

// The sections the parent genuinely uses, so dropping any of them would be a bug the resolution test
// cannot catch (a real heading reads fine yet the parent still needs it). §0 carries the parent's
// session-cut / resume paragraph, and §2's table the triggers of the parent's delegation, prefix,
// filings, backgrounded children and human-review classification (joshuafolkken/kit#3174).
const PARENT_NEEDS: ReadonlyArray<string> = [
	'0. The rule that fires before any of them — explicit invocation',
	'2. What every one of them shares',
]

function by_text(left: string, right: string): number {
	return left.localeCompare(right)
}

function skill_bytes(report: ReturnType<typeof backlogrun_parent_read_set.costed>): number {
	return report.files.find((one) => one.file === entry_read_set.SKILL_FILE)?.cost.bytes ?? NOTHING
}

describe('backlogrun_parent_read_set.costed — the SKILL.md section trim', () => {
	const skill = document_section.read_optional(
		entry_read_set.document_path(ROOT, entry_read_set.SKILL_FILE),
	)

	// Every unused section must resolve: a miss would silently under-count the saving and leave the
	// parent reading the section whole, so this pins that every heading is one the document carries.
	it.each([...backlogrun_parent_read_set.UNUSED_SKILL_SECTIONS])(
		'resolves the unused section %j',
		(heading) => {
			expect(document_section.section(skill ?? '', heading)).toBeDefined()
		},
	)

	// The core guard: a section the parent needs must never be in the dropped set. If a later edit
	// moves one of these into UNUSED_SKILL_SECTIONS, this fails — which is the "dropped a needed
	// section" case the resolution test above cannot see.
	it.each([...PARENT_NEEDS])('keeps the section %j the parent needs', (heading) => {
		// Resolve it first, so a mistyped heading here cannot pass the drop guard trivially.
		expect(document_section.section(skill ?? '', heading)).toBeDefined()
		expect(backlogrun_parent_read_set.UNUSED_SKILL_SECTIONS).not.toContain(heading)
	})

	// A different trim from the worker's: the parent keeps §0, which the lane child drops. The two sets
	// must genuinely differ, not converge to one.
	it('drops a different set of sections than the lane child', () => {
		expect([...backlogrun_parent_read_set.UNUSED_SKILL_SECTIONS].toSorted(by_text)).not.toEqual(
			[...lane_child_read_set.UNUSED_SKILL_SECTIONS].toSorted(by_text),
		)
	})
})

describe('backlogrun_parent_read_set.costed — the reduction', () => {
	it('charges the parent less for SKILL.md than a full backlogrun read', () => {
		const base = entry_read_set.costed(ROOT, BACKLOGRUN)
		const base_skill = base.files.find((one) => one.file === entry_read_set.SKILL_FILE)?.cost.bytes

		expect(skill_bytes(backlogrun_parent_read_set.costed(ROOT))).toBeLessThan(base_skill ?? NOTHING)
	})

	it('drops the entry read below the untrimmed backlogrun entry', () => {
		const trimmed = backlogrun_parent_read_set.costed(ROOT).scoped.tokens
		const base = entry_read_set.costed(ROOT, BACKLOGRUN).scoped.tokens

		expect(trimmed).toBeLessThan(base)
	})

	it('keeps the scoped read at or below the whole read', () => {
		const report = backlogrun_parent_read_set.costed(ROOT)

		expect(report.scoped.tokens).toBeLessThanOrEqual(report.whole.tokens)
	})

	it('reports under the backlogrun label, and drops no point-of-use document', () => {
		const report = backlogrun_parent_read_set.costed(ROOT)
		const reached = backlogrun_parent_read_set.REACHED_POINT_OF_USE
		const base = entry_read_set.costed(ROOT, BACKLOGRUN, reached)

		expect(report.entry).toBe(BACKLOGRUN)
		expect(report.point_of_use.map((one) => one.file)).toEqual(
			base.point_of_use.map((one) => one.file),
		)
	})
})
