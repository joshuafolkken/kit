import { describe, expect, it } from 'vitest'
import { document_section } from './document-section'
import { entry_read_set } from './entry-read-set'
import { lane_child_read_set } from './lane-child-read-set'

// joshuafolkken/kit#2021. The dispatched lane child reads a trimmed `fullrun` set: the point-of-use
// documents the parent owns are dropped, and the entry-only `SKILL.md` sections are read at the
// section level. What is pinned here is that the trim is real and derived — the child set is built
// off `fullrun`'s own figures, so it cannot drift away from them. The saving is measured against a
// `fullrun` that also read what the child reaches beyond it (joshuafolkken/kit#3172): `pre-gate-cut.md`
// left `fullrun`'s path for the child's alone, and `fullrun` stopped being charged for the whole of
// `backlogrun-progress.md`, so a margin over a bare `fullrun` measured that over-count, not the trim.
// The required saving is what the trim itself saves: the SKILL.md sections, `latest-gate.md`, the two
// decision documents and `progress-watcher.md`. The pinned saving is lowered whenever the skipped
// documents shrink for every entry (joshuafolkken/kit#3174, #3566, #3871 and #3928): skipping a smaller document saves less
// while the child reads less in absolute terms.

const ROOT = process.cwd()
const FULLRUN = 'fullrun'
const BYTES_PER_KB = 1024
const REQUIRED_SAVING_BYTES = 15 * BYTES_PER_KB
const MAX_INITIAL_TOKENS = 24_000
// The total counts every document the child really opens, at the entry and at its points of use, so
// it moves only when that set does (joshuafolkken/kit#2119, #2289, #2357 and #3399 each moved it);
// the saving vs `fullrun` the trim exists for (#2021) is pinned above.
const MAX_TOTAL_TOKENS = 14_000
const NOTHING = 0

function total_read_bytes(report: ReturnType<typeof entry_read_set.costed>): number {
	return entry_read_set.total([report.scoped, ...report.point_of_use.map((one) => one.cost)]).bytes
}

function total_read_tokens(report: ReturnType<typeof entry_read_set.costed>): number {
	return entry_read_set.total([report.scoped, ...report.point_of_use.map((one) => one.cost)]).tokens
}

describe('lane_child_read_set.costed — the point-of-use trim', () => {
	const report = lane_child_read_set.costed(ROOT)
	const files = report.point_of_use.map((one) => one.file)

	it.each([...lane_child_read_set.SKIPPED_POINT_OF_USE])('drops %s the parent owns', (file) => {
		expect(files).not.toContain(file)
	})

	// The gate, the PR and a park are the child's own, so their point-of-use documents stay.
	// `latest-gate.md` is not among them (joshuafolkken/kit#2189): the dependency update runs once per
	// session in the parent, never in a dispatched child, so it is a `SKIPPED_POINT_OF_USE` entry above.
	it.each(['chain-rule.md', 'background-commands.md', 'followup.md', 'backlogrun-park.md'])(
		'keeps %s the child does reach',
		(file) => {
			expect(files).toContain(file)
		},
	)
})

describe('lane_child_read_set.costed — the SKILL.md section trim', () => {
	// Every unused section must resolve: a miss would silently under-count the saving, so this pins
	// that every heading is one the document actually carries.
	const skill = document_section.read_optional(
		entry_read_set.document_path(ROOT, entry_read_set.SKILL_FILE),
	)

	it.each([...lane_child_read_set.UNUSED_SKILL_SECTIONS])(
		'resolves the unused section %j',
		(heading) => {
			expect(document_section.section(skill ?? '', heading)).toBeDefined()
		},
	)

	it('charges the child less for SKILL.md than a full fullrun read', () => {
		const base = entry_read_set.costed(ROOT, FULLRUN)

		function skill_of(report: ReturnType<typeof entry_read_set.costed>): number {
			const skill_row = report.files.find((one) => one.file === entry_read_set.SKILL_FILE)

			return skill_row?.cost.bytes ?? NOTHING
		}

		expect(skill_of(lane_child_read_set.costed(ROOT))).toBeLessThan(skill_of(base))
	})
})

describe('lane_child_read_set.costed — the whole reduction', () => {
	it('reads at least 15KB less than a fullrun that also read what the child reaches', () => {
		const child = lane_child_read_set.costed(ROOT)
		const reached = child.point_of_use
			.filter((one) => lane_child_read_set.REACHED_POINT_OF_USE.has(one.file))
			.map((one) => one.cost)
		const base = total_read_bytes(entry_read_set.costed(ROOT, FULLRUN))
		const saved = base + entry_read_set.total(reached).bytes - total_read_bytes(child)

		expect(saved).toBeGreaterThanOrEqual(REQUIRED_SAVING_BYTES)
	})

	it('keeps the scoped read below the whole read', () => {
		const report = lane_child_read_set.costed(ROOT)

		expect(report.scoped.tokens).toBeLessThanOrEqual(report.whole.tokens)
	})

	it('keeps the initial instruction context at or below 24k tokens', () => {
		expect(lane_child_read_set.costed(ROOT).scoped.tokens).toBeLessThanOrEqual(MAX_INITIAL_TOKENS)
	})

	it('keeps the total read at or below 14k tokens', () => {
		const tokens = total_read_tokens(lane_child_read_set.costed(ROOT))

		expect(tokens).toBeLessThanOrEqual(MAX_TOTAL_TOKENS)
	})
})
