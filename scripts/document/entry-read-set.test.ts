import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { entry_read_set } from './entry-read-set'

// joshuafolkken/kit#1776. What is asserted here is that the set is **derived**: the files come from
// `SKILL.md` → "1. Which file to read" and the sections from the references those files carry, so a
// row moved in that table moves the measurement with it. A transcribed copy would pass every one of
// these against itself and say nothing about the documents.

const ROOT = process.cwd()
// `fullrun` reads its own file, `split-assessment.md` and the skill; it cites `backlogrun.md` at more
// than one out-of-set section ("The hand-off", "Progress while the run is quiet"), so it exercises the
// section-saving measurement the removed `queue` entry used to (joshuafolkken/kit#1984).
const SECTION_CITER = 'fullrun'
const BACKLOGRUN = 'backlogrun.md'
const CHAIN_RULE = 'chain-rule.md'
const BACKGROUND_COMMANDS = 'background-commands.md'
const UNKNOWN_ENTRY = 'no-such-entry'
// The margin the section read has to beat: the cited sections together stay under two thirds of the
// files they were cut from. Loose on purpose — it asserts the shape, not today's figure.
const HALF_AGAIN = 1.5
const NOTHING = 0

const IMPLEMENTING: ReadonlyArray<string> = ['fullrun', 'halfrun', 'backlogrun']
const PLAN_ONLY = 'kickoff'
const EXPECTED_ENTRIES: ReadonlyArray<string> = ['backlogrun', 'fullrun', 'halfrun', 'kickoff']

function alphabetical(left: string, right: string): number {
	return left.localeCompare(right)
}

// joshuafolkken/kit#1879: the skill bodies are no longer copied into a consumer's tree — they ship as
// the `kit` plugin — so `josh doc:section` and `josh read:set` resolve a bare filename against the
// package's own copy when the project has no skill tree. In the kit repo the project path always
// exists, so the fallback never fires here.
describe('entry_read_set.document_path — consumer fallback', () => {
	it('resolves against the project when the project has the file', () => {
		expect(entry_read_set.document_path(ROOT, BACKLOGRUN)).toBe(
			path.join(ROOT, entry_read_set.SKILL_DIRECTORY, BACKLOGRUN),
		)
	})

	it('falls back to the package copy when the project has no skill tree', () => {
		const resolved = entry_read_set.document_path(path.join(ROOT, 'no-such-consumer'), BACKLOGRUN)

		expect(existsSync(resolved)).toBe(true)
		expect(resolved).toContain(path.join(entry_read_set.SKILL_DIRECTORY, BACKLOGRUN))
	})
})

describe('entry_read_set.read_set — which files', () => {
	it('reads every keyword out of the table, and no more', () => {
		expect(entry_read_set.entries(ROOT).toSorted(alphabetical)).toStrictEqual(
			EXPECTED_ENTRIES.toSorted(alphabetical),
		)
	})

	// §1 also carries a two-column table under a `###` subsection — the point-of-use triggers — whose
	// rows parse as entry rows, and the parse stops before it (joshuafolkken/kit#1797). Asserted in
	// `scripts/entry-fetch-document-rule.test.ts` against a fixture rather than here: in the live
	// document those rows are suppressed by `push_row`'s own guard, so a check here would pass with
	// the stop deleted.

	it('always includes the skill file itself, which the table does not list', () => {
		expect(entry_read_set.read_set(ROOT, 'kickoff').files).toContain(entry_read_set.SKILL_FILE)
	})

	// joshuafolkken/kit#1797: the two gate documents and `followup.md` are read by the command that
	// has to obey them, in full and in the same turn, so no entry reads one at the entry. Asserted
	// over every keyword rather than over `kickoff` alone — the old rule exempted the plan-only entry
	// and this one has no exemption to make.
	it.each([...IMPLEMENTING, PLAN_ONLY])('gives %s no point-of-use document', (entry) => {
		const { files } = entry_read_set.read_set(ROOT, entry)

		for (const later of entry_read_set.POINT_OF_USE_FILES) expect(files).not.toContain(later)
	})

	it("takes backlogrun's declared files from the table row", () => {
		expect(entry_read_set.read_set(ROOT, 'backlogrun').files).toEqual(
			expect.arrayContaining([BACKLOGRUN]),
		)
	})

	// A keyword with no row contributes no declared file, so what is left is the skill file alone —
	// never a throw and never an empty set.
	it('answers with the shared files alone for a keyword the table does not carry', () => {
		expect(entry_read_set.read_set(ROOT, UNKNOWN_ENTRY).files).toStrictEqual([
			entry_read_set.SKILL_FILE,
		])
	})

	// A pointer into a point-of-use document is not an entry cost either: counted, it would put
	// `followup.md` back into the entry figure under another name.
	it.each([...IMPLEMENTING])('counts no section of a point-of-use document for %s', (entry) => {
		const cited = entry_read_set.read_set(ROOT, entry).sections.map((one) => one.file)

		for (const later of entry_read_set.POINT_OF_USE_FILES) expect(cited).not.toContain(later)
	})
})

describe('entry_read_set — chain-rule.md is point-of-use (joshuafolkken/kit#1856)', () => {
	// chain-rule.md governs the /code-review → followup chain, which binds after the first edit, so it
	// left the entry read of the four entries that used to list it and joined the point-of-use set. A
	// named guard rather than the dynamic loop, so the reduction is pinned by the document it is about.
	it('classifies chain-rule.md as a point-of-use document', () => {
		expect([...entry_read_set.POINT_OF_USE_FILES]).toContain(CHAIN_RULE)
	})

	it.each(['fullrun', 'backlogrun'])(
		'keeps chain-rule.md out of the entry read of %s, which once read it whole',
		(entry) => {
			expect(entry_read_set.read_set(ROOT, entry).files).not.toContain(CHAIN_RULE)
		},
	)
})

describe('entry_read_set — background-commands.md is point-of-use (joshuafolkken/kit#1873)', () => {
	// §2h's body left SKILL.md for background-commands.md, read before the first backgroundable command
	// (the gate). It binds only after the first edit, so it never belonged in the entry read — and
	// because it was never a table row, the general loop above already keeps it out of every entry; what
	// this pins is that it is classified point-of-use in the first place.
	it('classifies background-commands.md as a point-of-use document', () => {
		expect([...entry_read_set.POINT_OF_USE_FILES]).toContain(BACKGROUND_COMMANDS)
	})
})

describe('entry_read_set — eval-gate.md is gone from the read set (joshuafolkken/kit#1922)', () => {
	const EVAL_GATE = 'eval-gate.md'

	// The rule-compliance measurement left the completion gate, so `eval-gate.md` was deleted and is no
	// longer read at any point of a run. It must be neither an entry file nor a classified point-of-use
	// document — acceptance criterion of joshuafolkken/kit#1922.
	it('is not a classified point-of-use document', () => {
		expect([...entry_read_set.POINT_OF_USE_FILES]).not.toContain(EVAL_GATE)
	})

	it.each([...IMPLEMENTING, PLAN_ONLY])('does not appear in the read set of %s', (entry) => {
		const { files, sections } = entry_read_set.read_set(ROOT, entry)

		expect(files).not.toContain(EVAL_GATE)
		expect(sections.map((reference) => reference.file)).not.toContain(EVAL_GATE)
	})
})

describe('entry_read_set.read_set — which sections', () => {
	it('collects the sections its own documents point at, out of the set', () => {
		expect(entry_read_set.read_set(ROOT, SECTION_CITER).sections).toEqual(
			expect.arrayContaining([{ file: BACKLOGRUN, heading: 'The hand-off' }]),
		)
	})

	// A reference into a file the entry already reads whole costs nothing extra, so counting it would
	// overstate the saving.
	it('counts no section of a file the entry reads in full', () => {
		const { files, sections } = entry_read_set.read_set(ROOT, 'backlogrun')

		expect(files).toContain(BACKLOGRUN)
		expect(sections.map((reference) => reference.file)).not.toContain(BACKLOGRUN)
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

	it('resolves every section the fullrun entry references', () => {
		const { sections } = entry_read_set.costed(ROOT, SECTION_CITER)

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
	// negative saving (joshuafolkken/kit#1776 review round 1). `scoped` joins that file's cited sections
	// into one span, so it can exceed the per-reference sum only by the single newline joining each pair
	// — never by a whole section, which is what a real double-count would add. Compared in bytes,
	// because a token estimate rounds each side independently; the separator budget is one byte per
	// section (joshuafolkken/kit#1922).
	it('charges a file cited more than once only once between its references', () => {
		const report = entry_read_set.costed(ROOT, SECTION_CITER)
		const per_reference = entry_read_set.total(report.sections.map((section) => section.cost))
		const own = entry_read_set.total(report.files.map((file) => file.cost))

		expect(report.scoped.bytes - own.bytes).toBeLessThanOrEqual(
			per_reference.bytes + report.sections.length,
		)
	})

	// **A file cited at non-adjacent sections fabricates no boundary token** (joshuafolkken/kit#1934).
	// The fullrun entry cites disjoint, non-adjacent `backlogrun.md` sections; costing their union by
	// joining the skipped-gap lines into one string fabricated a token at every gap, drifting `scoped`
	// a token above the per-reference sum and printing a false negative saving. Costed as contiguous
	// runs instead, the deduped figure equals the per-reference sum exactly — none of these references
	// overlaps, so no line is dropped and none is fabricated. A regression to the join would break the
	// equality upward, which the `<=` guard above would also catch; this pins the exact expected value.
	it('fabricates no boundary token for a file cited at non-adjacent sections', () => {
		const report = entry_read_set.costed(ROOT, SECTION_CITER)
		const per_reference = entry_read_set.total(report.sections.map((section) => section.cost))
		const own = entry_read_set.total(report.files.map((file) => file.cost))

		expect(report.scoped.tokens - own.tokens).toBe(per_reference.tokens)
	})

	// The whole point of the measurement: the sections a `fullrun` entry cites are a fraction of the
	// files it used to open for them. Equal figures would mean the reference scan had stopped
	// resolving and every pointer was being charged at its file.
	it('charges the referenced sections far less than the files they sit in', () => {
		const report = entry_read_set.costed(ROOT, SECTION_CITER)
		const cited = entry_read_set.total(report.sections.map((section) => section.cost))
		const referenced = report.whole.tokens - report.scoped.tokens + cited.tokens

		expect(cited.tokens * HALF_AGAIN).toBeLessThan(referenced)
	})
})
