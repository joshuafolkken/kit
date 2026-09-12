import { read_repo_file, read_unwrapped } from '#scripts/ai-document-fixture'
import { entry_read_set } from '#scripts/document/entry-read-set'
import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#1776. The rule that a `` `X.md` → "Heading" `` pointer is read as that section
// rather than by opening the file, and the two commands that make it mechanical.
//
// **What this suite is really guarding is that nothing was dropped to buy the reduction.** The Issue
// forbids deleting or shrinking a rule, so the assertions below are in two halves: the new rule is
// written where a run will read it, and **every document in the entry read set is still the file it
// was** — same path, same skill directory, so every marker suite that pins a sentence in one of them
// still pins it at the place it pins.

const SKILL = '.claude/skills/workflow-commands/SKILL.md'
const DOCS = 'docs/josh-commands.md'

const SECTION_COMMAND = 'doc:section'
const SECTION_ALIAS = 'ds'
const SECTION_SCRIPT = 'scripts/document/document-section-cli.ts'
const SET_COMMAND = 'read:set'
const SET_ALIAS = 'rs'
const SET_SCRIPT = 'scripts/document/read-set-cli.ts'

const SKILL_MARKERS: ReadonlyArray<string> = [
	// The rule itself, as the thing it is and the thing it is not.
	'is read as that section, never by opening `X.md` whole',
	'pnpm josh doc:section <file.md> "<heading>"',
	'pnpm josh read:set [<keyword>]',
	// The measurement, so a later change to the mechanism has to argue with the figures.
	'159,323 billed input tokens per request at 16 requests',
	'37,184 tokens — about a quarter of the whole entry read',
	// The half that separates this from the scheme joshuafolkken/kit#1344 and #1460 measured failing.
	'Nothing is deferred and nothing is summarized',
	'no path on which a run proceeds having only supposed it read something',
	// The two refusals, which are what make a drifted pointer loud rather than empty.
	'A heading that does not resolve is refused',
	'an ambiguous prefix is refused too',
	'this document is itself in the set it measures',
	// The derivation, which is what keeps the enumeration from becoming a second copy of the table.
	'The set is derived rather than transcribed',
	'The section-reference mechanism moved no rule and split no document to buy its 27%',
	// joshuafolkken/kit#1797 did split two bodies out, so the claim above is scoped to the mechanism
	// it was written about and the move states its own constraint — nothing deleted, nothing
	// summarized, every assertion re-pointed rather than dropped.
	'Not one sentence was deleted or summarized, and not one assertion was dropped',
]

const DOC_MARKERS: ReadonlyArray<string> = [
	'### `josh doc:section`',
	'### `josh read:set`',
	// The two figures, named, because a saving reported without saying what it is a saving from is
	// the kind of number this command exists to replace.
	'| `whole`  |',
	'| `scoped` |',
	'An unresolvable reference is charged at its whole file',
	'The set is derived, never transcribed',
]

describe.each([
	[SECTION_COMMAND, SECTION_ALIAS, SECTION_SCRIPT],
	[SET_COMMAND, SET_ALIAS, SET_SCRIPT],
])('%s is registered', (command, alias, script) => {
	it('runs the script it is documented as running', () => {
		expect(COMMAND_MAP[command]?.script).toBe(script)
	})

	it('has the short alias the documents print', () => {
		expect(ALIASES[alias]).toBe(command)
	})
})

describe(`${SKILL} states the section-reference rule`, () => {
	it.each(SKILL_MARKERS)('states: %j', (marker) => {
		expect(read_unwrapped(SKILL)).toContain(marker)
	})
})

describe(`${DOCS} documents both commands`, () => {
	it.each(DOC_MARKERS)('mentions: %j', (marker) => {
		expect(read_repo_file(DOCS)).toContain(marker)
	})
})

// **The reduction moved no rule, and this is what says so.** Every document named by the entry read
// set is still a file in the workflow skill directory: nothing was extracted to a new home, so no
// marker suite had to be re-pointed and no sentence could have been lost on the way.
describe('no document of the entry read set was moved or removed', () => {
	const root = process.cwd()
	const named = [
		...new Set(
			entry_read_set
				.entries(root)
				.flatMap((entry) => entry_read_set.read_set(root, entry))
				.flatMap((set) => [...set.files, ...set.sections.map((reference) => reference.file)]),
		),
	]

	it.each(named)('%s is still where the documents cite it', (name) => {
		expect(read_repo_file(entry_read_set.document_path('', name))).not.toBe('')
	})
})
