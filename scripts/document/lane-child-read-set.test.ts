import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { document_section } from './document-section'
import { entry_read_set } from './entry-read-set'
import { lane_child_read_set } from './lane-child-read-set'

// The dedicated entry must retain the child's shipping and park procedures while reducing reads.

const ROOT = process.cwd()
const FULLRUN = 'fullrun'
const BYTES_PER_KB = 1024
const REQUIRED_SAVING_BYTES = 14 * BYTES_PER_KB
const MAX_INITIAL_TOKENS = 24_000
// The total counts every document the child really opens, at the entry and at its points of use, so
// it moves only when that set does (joshuafolkken/kit#2119, #2289, #2357 and #3399 each moved it);
// the saving vs `fullrun` the trim exists for (#2021) is pinned above.
const MAX_TOTAL_TOKENS = 14_000

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

describe('lane_child_read_set.costed — the dedicated entry', () => {
	it('counts the split question printed by run:entry at its section cost', () => {
		const file = 'split-assessment.md'
		const heading = 'The question'
		const text = readFileSync(entry_read_set.document_path(ROOT, file), 'utf8')
		const section = document_section.section(text, heading)?.text ?? ''
		const row = lane_child_read_set.costed(ROOT).point_of_use.find((one) => one.file === file)

		expect(section).not.toBe('')
		expect(row).toEqual({ file, heading, cost: entry_read_set.cost_of(section), is_resolved: true })
	})

	it('counts the actual dedicated entry without the interactive entry documents', () => {
		const report = lane_child_read_set.costed(ROOT)
		const file = 'fullrun-lane.md'
		const text = readFileSync(entry_read_set.document_path(ROOT, file), 'utf8')

		expect(report.files).toEqual([{ file, cost: entry_read_set.cost_of(text) }])
		expect(report.sections.every((one) => one.is_resolved)).toBe(true)
		expect(report.point_of_use.every((one) => one.is_resolved)).toBe(true)
	})
})

describe('lane_child_read_set.costed — the whole reduction', () => {
	it('reads at least 14KB less than a fullrun that also read what the child reaches', () => {
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
