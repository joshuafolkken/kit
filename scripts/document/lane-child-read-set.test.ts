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
// `backlogrun-progress.md`, so the old 35KB margin over a bare `fullrun` measured that over-count, not
// the trim. 17KB is what the trim itself saves: the SKILL.md sections, `latest-gate.md`, the two
// decision documents and `progress-watcher.md`. Lowered from 22KB in joshuafolkken/kit#3174, which cut
// the SKILL.md sections the child skipped out of the document for every entry: the saving moved from
// the trim into the shared read, so the child reads less in absolute terms while the margin narrows.
// Lowered from 18KB in joshuafolkken/kit#3566, which moved history out of `latest-gate.md` and
// `progress-watcher.md`: the documents the child skips got smaller, so skipping them saves less.

const ROOT = process.cwd()
const FULLRUN = 'fullrun'
const BYTES_PER_KB = 1024
const REQUIRED_SAVING_BYTES = 17 * BYTES_PER_KB
const MAX_INITIAL_TOKENS = 24_000
// Raised from 30k when joshuafolkken/kit#2119 added two delivered-rule rows (the scout and the
// per-run filing cap) to `rule-delivery.md`, which the child reads whole. Raised again to 40k in
// joshuafolkken/kit#2289: `pre-gate-cut.md` joined the point-of-use set, so the ~9.8k tokens a lane
// child *already* read at the pre-gate cut but the count omitted now appear in this total. The
// increase is a correction of an under-count, not new reading. Lowered to 22k in joshuafolkken/kit#2357
// when `backlogrun-steps.md` left the child's point-of-use set: the child never opened the scheduler's
// step list, so its ~16k tokens were an over-count the total no longer carries. The #2021 acceptance
// criterion the trim exists for is the 35KB saving vs `fullrun`, which is pinned above and only widens.
// Lowered to 14k in joshuafolkken/kit#3399 when `rule-delivery.md`'s rule table moved behind
// `pnpm josh rule:list`: the child no longer reads the table whole, and the total measured 13.6k.
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
	it('reads at least 17KB less than a fullrun that also read what the child reaches', () => {
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
