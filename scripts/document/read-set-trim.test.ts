import { describe, expect, it } from 'vitest'
import { entry_read_set } from './entry-read-set'
import { read_set_trim, type TrimSpec } from './read-set-trim'

// joshuafolkken/kit#3253: the trim both role-specific read sets derive from had no test of its own;
// `lane-child-read-set.test.ts` and `backlogrun-parent-read-set.test.ts` pin each role's figures, not
// the arithmetic they share. Pinned here against the real `fullrun` entry, so the expected numbers are
// derived from the same base rather than transcribed.

const ROOT = process.cwd()
const BASE_ENTRY = 'fullrun'
const LABEL = 'trimmed'
const UNUSED_SECTION = '3. What stays resident, and what is read from here'
const NO_SECTIONS: ReadonlyArray<string> = []
const NOTHING: ReadonlySet<string> = new Set()

function spec(overrides: Partial<TrimSpec>): TrimSpec {
	return {
		base_entry: BASE_ENTRY,
		label: LABEL,
		unused_skill_sections: NO_SECTIONS,
		skipped_point_of_use: NOTHING,
		reached_point_of_use: NOTHING,
		...overrides,
	}
}

function skill_bytes(report: ReturnType<typeof read_set_trim.costed>): number {
	return report.files.find((file) => file.file === entry_read_set.SKILL_FILE)?.cost.bytes ?? 0
}

describe('read_set_trim.costed — a trim that removes nothing', () => {
	const base = entry_read_set.costed(ROOT, BASE_ENTRY)
	const report = read_set_trim.costed(ROOT, spec({}))

	it('reports under its own label', () => {
		expect(report.entry).toBe(LABEL)
	})

	it('keeps the base entry figures unchanged', () => {
		expect({ ...report, entry: base.entry }).toEqual(base)
	})
})

describe('read_set_trim.costed — an unused SKILL.md section', () => {
	const base = read_set_trim.costed(ROOT, spec({}))
	const report = read_set_trim.costed(ROOT, spec({ unused_skill_sections: [UNUSED_SECTION] }))
	const saving = skill_bytes(base) - skill_bytes(report)

	it('charges the SKILL.md row less', () => {
		expect(saving).toBeGreaterThan(0)
	})

	it('leaves every other row unchanged', () => {
		const others = (one: typeof report): typeof report.files =>
			one.files.filter((file) => file.file !== entry_read_set.SKILL_FILE)

		expect(others(report)).toEqual(others(base))
	})

	it('takes the same saving off the whole and the scoped totals', () => {
		expect(base.whole.bytes - report.whole.bytes).toBe(saving)
		expect(base.scoped.bytes - report.scoped.bytes).toBe(saving)
	})
})

describe('read_set_trim.costed — a point-of-use document the role does not own', () => {
	const base = read_set_trim.costed(ROOT, spec({}))
	const skipped = base.point_of_use[0]?.file ?? ''
	const report = read_set_trim.costed(ROOT, spec({ skipped_point_of_use: new Set([skipped]) }))

	it('drops the skipped document and keeps the rest', () => {
		expect(skipped).not.toBe('')
		expect(report.point_of_use.map((one) => one.file)).toEqual(
			base.point_of_use.map((one) => one.file).filter((file) => file !== skipped),
		)
	})
})
