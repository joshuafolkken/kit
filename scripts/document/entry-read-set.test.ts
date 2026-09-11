import { describe, expect, it } from 'vitest'
import { entry_read_set } from './entry-read-set'

// joshuafolkken/kit#1776. What is asserted here is that the set is **derived**: the files come from
// `SKILL.md` → "1. Which file to read" and the sections from the references those files carry, so a
// row moved in that table moves the measurement with it. A transcribed copy would pass every one of
// these against itself and say nothing about the documents.

const ROOT = process.cwd()
const QUEUE = 'queue'
const EPICRUN = 'epicrun.md'
const UNKNOWN_ENTRY = 'no-such-entry'
// The margin the section read has to beat: the cited sections together stay under two thirds of the
// files they were cut from. Loose on purpose — it asserts the shape, not today's figure.
const HALF_AGAIN = 1.5
const NOTHING = 0

const IMPLEMENTING: ReadonlyArray<string> = ['fullrun', 'halfrun', QUEUE, 'epicrun', 'backlogrun']
const EXPECTED_ENTRIES: ReadonlyArray<string> = [
	'backlogrun',
	'epicrun',
	'fullrun',
	'halfrun',
	'kickoff',
	QUEUE,
]

function alphabetical(left: string, right: string): number {
	return left.localeCompare(right)
}

describe('entry_read_set.read_set — which files', () => {
	it('reads every keyword out of the table, and no more', () => {
		expect(entry_read_set.entries(ROOT).toSorted(alphabetical)).toStrictEqual(
			EXPECTED_ENTRIES.toSorted(alphabetical),
		)
	})

	it('always includes the skill file itself, which the table does not list', () => {
		expect(entry_read_set.read_set(ROOT, 'kickoff').files).toContain(entry_read_set.SKILL_FILE)
	})

	it.each(IMPLEMENTING)('gives %s both gate documents', (entry) => {
		expect(entry_read_set.read_set(ROOT, entry).files).toEqual(
			expect.arrayContaining([...entry_read_set.GATE_FILES]),
		)
	})

	// `kickoff` never implements, so it reaches neither the dependency-update step nor the gate.
	it('gives the plan-only entry neither gate document', () => {
		const { files } = entry_read_set.read_set(ROOT, entry_read_set.PLAN_ONLY_ENTRY)

		for (const gate of entry_read_set.GATE_FILES) expect(files).not.toContain(gate)
	})

	it("takes queue's declared files from the table row", () => {
		expect(entry_read_set.read_set(ROOT, QUEUE).files).toEqual(
			expect.arrayContaining(['queue.md', 'fullrun.md', 'chain-rule.md', 'followup.md']),
		)
	})

	// A keyword with no row contributes no declared file, so what is left is the skill file plus the
	// gate documents every implementing entry reaches — never a throw and never an empty set.
	it('answers with the shared files alone for a keyword the table does not carry', () => {
		expect(entry_read_set.read_set(ROOT, UNKNOWN_ENTRY).files).toStrictEqual([
			entry_read_set.SKILL_FILE,
			...entry_read_set.GATE_FILES,
		])
	})
})

describe('entry_read_set.read_set — which sections', () => {
	it('collects the sections its own documents point at, out of the set', () => {
		expect(entry_read_set.read_set(ROOT, QUEUE).sections).toEqual(
			expect.arrayContaining([{ file: EPICRUN, heading: 'The hand-off' }]),
		)
	})

	// A reference into a file the entry already reads whole costs nothing extra, so counting it would
	// overstate the saving.
	it('counts no section of a file the entry reads in full', () => {
		const { files, sections } = entry_read_set.read_set(ROOT, 'epicrun')

		expect(files).toContain(EPICRUN)
		expect(sections.map((reference) => reference.file)).not.toContain(EPICRUN)
	})

	it('counts no reference to a document outside this skill directory', () => {
		const names = entry_read_set
			.entries(ROOT)
			.flatMap((entry) => entry_read_set.read_set(ROOT, entry).sections)
			.map((reference) => reference.file)

		expect(names).not.toContain('CLAUDE.md')
	})
})

describe('entry_read_set.costed', () => {
	it.each(entry_read_set.entries(ROOT))('puts %s scoped read below its whole read', (entry) => {
		const report = entry_read_set.costed(ROOT, entry)

		expect(report.scoped.tokens).toBeLessThanOrEqual(report.whole.tokens)
	})

	it('resolves every section the queue entry references', () => {
		const { sections } = entry_read_set.costed(ROOT, QUEUE)

		expect(sections.length).toBeGreaterThan(NOTHING)
		expect(sections.every((section) => section.is_resolved)).toBe(true)
	})

	// The saving is the part of a referenced file the reference never pointed at, so an entry that
	// references nothing outside its own set has to measure the two figures equal.
	it('measures the two figures equal where nothing is referenced out of the set', () => {
		const report = entry_read_set.costed(ROOT, UNKNOWN_ENTRY)

		expect(report.scoped).toStrictEqual(report.whole)
	})

	// **A file cited more than once is charged once between its references** — summing them instead
	// double-counts, and with two unresolved headings it could push `scoped` above `whole` and print a
	// negative saving (joshuafolkken/kit#1776 review round 1).
	it('charges a file cited more than once only once between its references', () => {
		const report = entry_read_set.costed(ROOT, QUEUE)
		const per_reference = entry_read_set.total(report.sections.map((section) => section.cost))
		const own = entry_read_set.total(report.files.map((file) => file.cost))

		expect(report.scoped.tokens - own.tokens).toBeLessThanOrEqual(per_reference.tokens)
	})

	// The whole point of the measurement: the sections a `queue` entry cites are a fraction of the
	// files it used to open for them. Equal figures would mean the reference scan had stopped
	// resolving and every pointer was being charged at its file.
	it('charges the referenced sections far less than the files they sit in', () => {
		const report = entry_read_set.costed(ROOT, QUEUE)
		const cited = entry_read_set.total(report.sections.map((section) => section.cost))
		const referenced = report.whole.tokens - report.scoped.tokens + cited.tokens

		expect(cited.tokens * HALF_AGAIN).toBeLessThan(referenced)
	})
})
