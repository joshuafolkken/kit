import { read_repo_file } from '#scripts/ai-document-fixture'
import { entry_read_set } from '#scripts/document/entry-read-set'
import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#1776. The rule that a `` `X.md` → "Heading" `` pointer is read as that section
// rather than by opening the file, and the two commands that make it mechanical.
//
// joshuafolkken/kit#1959 moved the §1 explanation and its measurement out of the always-read skill
// (joshuafolkken/kit#1925 trims that meta prose), so the rule is guarded here off the command
// registration and `docs/josh-commands.md` — the command's own reference, which is not trimmed — plus
// the check that every document the entry read set names is still the file it was.

const DOCS = 'docs/josh-commands.md'

const SECTION_COMMAND = 'doc:section'
const SECTION_ALIAS = 'ds'
const SECTION_SCRIPT = 'scripts/document/document-section-cli.ts'
const SET_COMMAND = 'read:set'
const SET_ALIAS = 'rs'
const SET_SCRIPT = 'scripts/document/read-set-cli.ts'

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
