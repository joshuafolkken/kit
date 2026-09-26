import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { document_section } from './document-section'
import { entry_read_set } from './entry-read-set'

// joshuafolkken/kit#1776. What is asserted here is that the set is **derived**: the files come from
// `SKILL.md` → "1. Which file to read" and the sections from the references those files carry, so a
// row moved in that table moves the measurement with it. A transcribed copy would pass every one of
// these against itself and say nothing about the documents.

const ROOT = process.cwd()
// `fullrun` reads its own manifest and the skill; it cites `split-assessment.md` at one out-of-set
// section ("The question"), so it exercises the section-saving measurement — reading that section
// rather than the whole file it sits in. (joshuafolkken/kit#2189 turned the command files into
// manifests: `split-assessment.md` left the entry table and became a section-cite of the split
// decision, and the release-ask pointer at `followup-reference.md` moved into `fullrun-steps.md`,
// read on demand rather than at the entry.)
const SECTION_CITER = 'fullrun'
const SPLIT_QUESTION_HEADING = 'The question'
const SPLIT_FILE = 'split-assessment.md'
const BACKLOGRUN = 'backlogrun.md'
const CHAIN_RULE = 'chain-rule.md'
const BACKGROUND_COMMANDS = 'background-commands.md'
const FOLLOWUP = 'followup.md'
const CHAIN_HEADING = 'Run the review-to-merge chain'
const FOLLOWUP_HEADING = 'Run `pnpm josh followup`'
const BACKGROUND_HEADING = 'Background the gate and push'
const OPERATIONAL_POINT_OF_USE: ReadonlyArray<[string, string]> = [
	[CHAIN_RULE, CHAIN_HEADING],
	[FOLLOWUP, FOLLOWUP_HEADING],
	[BACKGROUND_COMMANDS, BACKGROUND_HEADING],
]
const MANDATORY_POINT_OF_USE: ReadonlyArray<[string, string, ReadonlyArray<string>]> = [
	[
		CHAIN_RULE,
		CHAIN_HEADING,
		['review:attest --check', 'review:round2', 'josh followup', 'confirmation'],
	],
	[
		FOLLOWUP,
		FOLLOWUP_HEADING,
		['required CI', 'completion Telegram', 'merges by default', 'josh ms'],
	],
	[BACKGROUND_COMMANDS, BACKGROUND_HEADING, ['josh gate', 'josh git -y', 'foreground']],
]
const UNKNOWN_ENTRY = 'no-such-entry'
// The margin the section read has to beat: the cited sections together stay under two thirds of the
// files they were cut from. Loose on purpose — it asserts the shape, not today's figure.
const HALF_AGAIN = 1.5
const MAX_BACKLOGRUN_TOKENS = 90_000
// The ceiling joshuafolkken/kit#2190 set on the `backlogrun` parent's own entry read — `SKILL.md` plus
// the `backlogrun.md` manifest, the referenced sections included. Cutting the detailed procedure into
// the point-of-use `backlogrun-steps.md` is what brought the entry read under it (measured ~13,800
// after the cut, from ~29,800 before), and this pins it so a manifest that grew the prose back would
// fail the gate.
const MAX_BACKLOGRUN_ENTRY_TOKENS = 20_000
const NOTHING = 0

const IMPLEMENTING: ReadonlyArray<string> = ['fullrun', 'halfrun', 'backlogrun']
const PLAN_ONLY = 'kickoff'
const EXPECTED_ENTRIES: ReadonlyArray<string> = ['backlogrun', 'fullrun', 'halfrun', 'kickoff']

function alphabetical(left: string, right: string): number {
	return left.localeCompare(right)
}

function point_of_use_text(file: string, heading: string): string {
	const markdown = document_section.read_optional(entry_read_set.document_path(ROOT, file)) ?? ''
	const text = document_section.section(markdown, heading)?.text ?? ''

	return text.replaceAll(/\s+/gu, ' ')
}

// The package skill remains available when the project has no local skill tree. The consumer
// precedence regression is covered by entry-read-budget.test.ts with a stale local copy.
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
	// `scripts/rules/entry-fetch-document-rule.test.ts` against a fixture rather than here: in the live
	// document those rows are suppressed by `push_row`'s own guard, so a check here would pass with
	// the stop deleted.

	it('always includes the skill file itself, which the table does not list', () => {
		expect(entry_read_set.read_set(ROOT, 'kickoff').files).toContain(entry_read_set.SKILL_FILE)
	})

	// The gate documents and `followup.md` are read by the command that has to obey them, at their
	// named point-of-use scope, so no entry reads one at the entry. Asserted
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

describe('entry_read_set — backlogrun reads its child files at the point of use (joshuafolkken/kit#2161)', () => {
	const ENTRY = 'backlogrun'
	const SPLIT = SPLIT_FILE
	const FULLRUN_FILE = 'fullrun.md'
	const PER_ENTRY: ReadonlyArray<string> = [FULLRUN_FILE, SPLIT, 'delegation.md', 'issue-scout.md']
	const IMPLEMENTING_AND_PLAN: ReadonlyArray<string> = [SECTION_CITER, 'halfrun', PLAN_ONLY]

	// The parent orchestrates and never implements: a dispatched child reads both inside its own
	// delegated fullrun unit, so neither is a backlogrun entry read.
	it.each(PER_ENTRY)('keeps %s out of the backlogrun entry read', (file) => {
		expect(entry_read_set.read_set(ROOT, ENTRY).files).not.toContain(file)
	})

	// `fullrun.md` stays the entry file of a `fullrun`; `split-assessment.md` left the entry table in
	// joshuafolkken/kit#2189 and is now section-cited ("The question") by every command manifest, so it
	// is no longer read whole at the entry of `fullrun` / `halfrun` / `kickoff`.
	it('keeps fullrun.md the entry file of a fullrun, split-assessment.md out of its whole-file read', () => {
		const { files } = entry_read_set.read_set(ROOT, SECTION_CITER)

		expect(files).toContain(FULLRUN_FILE)
		expect(files).not.toContain(SPLIT)
	})

	it.each(IMPLEMENTING_AND_PLAN)(
		'section-cites split-assessment.md from the %s manifest',
		(entry) => {
			const cited = entry_read_set.read_set(ROOT, entry).sections
			const split = cited.find((reference) => reference.file === SPLIT)

			expect(split?.heading).toBe(SPLIT_QUESTION_HEADING)
		},
	)

	it('classifies backlogrun child files and the shared deferred decisions', () => {
		const classified = [...(entry_read_set.POINT_OF_USE_BY_ENTRY.get(ENTRY) ?? [])]

		expect(classified.toSorted(alphabetical)).toStrictEqual([...PER_ENTRY].toSorted(alphabetical))
		expect(entry_read_set.POINT_OF_USE_BY_ENTRY.has(SECTION_CITER)).toBe(true)
	})

	// The saving is not a disappearance: the cost report still accounts for what the child reads later.
	it('reports the child files under the backlogrun point-of-use', () => {
		const files = entry_read_set.costed(ROOT, ENTRY).point_of_use.map((one) => one.file)

		for (const file of PER_ENTRY) expect(files).toContain(file)
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

describe('entry_read_set — point-of-use section costs', () => {
	const report = entry_read_set.costed(ROOT, 'fullrun')

	it.each(OPERATIONAL_POINT_OF_USE)('charges %s at section %s', (file, heading) => {
		expect(report.point_of_use).toContainEqual(
			expect.objectContaining({ file, heading, is_resolved: true }),
		)
	})

	it('keeps the operational point-of-use read smaller than the whole files', () => {
		const operational = report.point_of_use.filter(({ file }) =>
			OPERATIONAL_POINT_OF_USE.some(([named]) => named === file),
		)
		const scoped = entry_read_set.total(operational.map(({ cost }) => cost))
		const whole = entry_read_set.total(
			OPERATIONAL_POINT_OF_USE.map(([file]) =>
				entry_read_set.cost_of(
					document_section.read_optional(entry_read_set.document_path(ROOT, file)) ?? '',
				),
			),
		)

		expect(scoped.tokens).toBeLessThan(whole.tokens)
	})
})

describe('entry_read_set — point-of-use reachability', () => {
	it.each(MANDATORY_POINT_OF_USE)(
		'keeps the mandatory %s rules reachable',
		(file, heading, markers) => {
			const text = point_of_use_text(file, heading)

			expect(markers.map((marker) => text.includes(marker))).not.toContain(false)
		},
	)

	it('reduces the backlogrun total below 90k tokens', () => {
		const backlogrun = entry_read_set.costed(ROOT, 'backlogrun')
		const total = entry_read_set.total([
			backlogrun.scoped,
			...backlogrun.point_of_use.map(({ cost }) => cost),
		])

		expect(total.tokens).toBeLessThan(MAX_BACKLOGRUN_TOKENS)
	})

	// joshuafolkken/kit#2190: the manifest cut is about the *entry* read, not the total — the total is
	// unchanged because the prose only moved to a point-of-use file. `scoped` is what the parent pays
	// up front, and it is what has to stay under 20k.
	it('keeps the backlogrun entry read below 20k tokens', () => {
		expect(entry_read_set.costed(ROOT, 'backlogrun').scoped.tokens).toBeLessThan(
			MAX_BACKLOGRUN_ENTRY_TOKENS,
		)
	})
})

describe('entry_read_set — backlogrun-steps.md is point-of-use (joshuafolkken/kit#2190)', () => {
	// `backlogrun.md` was cut to a manifest and its detailed procedure moved into `backlogrun-steps.md`,
	// read on demand rather than at the entry. It must be classified point-of-use so the manifest's
	// pointers into it are not charged to the entry read, exactly as the four `backlogrun-*.md` phase
	// documents are.
	const STEPS = 'backlogrun-steps.md'

	it('classifies backlogrun-steps.md as a point-of-use document', () => {
		expect([...entry_read_set.POINT_OF_USE_FILES]).toContain(STEPS)
	})

	it('keeps backlogrun-steps.md out of the entry read of every entry', () => {
		for (const entry of EXPECTED_ENTRIES) {
			expect(entry_read_set.read_set(ROOT, entry).files).not.toContain(STEPS)
		}
	})

	// The saving is not a disappearance: the manifest's pointers reach it, and the cost report still
	// accounts for what the run reads later under the backlogrun point-of-use.
	it('reports backlogrun-steps.md under the backlogrun point-of-use', () => {
		const files = entry_read_set.costed(ROOT, 'backlogrun').point_of_use.map((one) => one.file)

		expect(files).toContain(STEPS)
	})
})

describe('entry_read_set — pre-gate-cut.md is point-of-use (joshuafolkken/kit#2289)', () => {
	// The pre-gate cut is a step every implementing run — and every dispatched lane child — reaches
	// after the entry, and `pre-gate-cut.md` is its single source, so its read is a point-of-use read.
	// It was silently omitted from the count: measured on the backlogrun of 2026-09-21 the lane children
	// read it 21 times across 13 runs, the largest single document read, with no row on the point-of-use
	// list. This is the named guard the acceptance criterion asks for — removing the file from the set
	// fails it.
	const PRE_GATE_CUT = 'pre-gate-cut.md'

	it('classifies pre-gate-cut.md as a point-of-use document', () => {
		expect([...entry_read_set.POINT_OF_USE_FILES]).toContain(PRE_GATE_CUT)
	})

	it('keeps pre-gate-cut.md out of the entry read of every entry', () => {
		for (const entry of EXPECTED_ENTRIES) {
			expect(entry_read_set.read_set(ROOT, entry).files).not.toContain(PRE_GATE_CUT)
		}
	})

	// The saving is not a disappearance: the run reads it later, so the cost report accounts for it
	// under the point-of-use, and the total read counts the ~7k tokens the old figure was short.
	it.each([...IMPLEMENTING])('reports pre-gate-cut.md under the %s point-of-use', (entry) => {
		const files = entry_read_set.costed(ROOT, entry).point_of_use.map((one) => one.file)

		expect(files).toContain(PRE_GATE_CUT)
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
			expect.arrayContaining([{ file: SPLIT_FILE, heading: SPLIT_QUESTION_HEADING }]),
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

	// **A file's cited sections fabricate no boundary token** (joshuafolkken/kit#1934). Costing a
	// file's cited sections by joining the skipped-gap lines into one string fabricated a token at
	// every gap, drifting `scoped` a token above the per-reference sum and printing a false negative
	// saving. Costed as contiguous runs instead, the deduped figure equals the per-reference sum
	// exactly. A regression to the join would break the equality upward, which the `<=` guard above
	// would also catch; this pins the exact expected value. (Before joshuafolkken/kit#2010 the fullrun
	// entry cited two non-adjacent `backlogrun.md` sections, which exercised the gap directly.)
	it('fabricates no boundary token for a file cited at its sections', () => {
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
