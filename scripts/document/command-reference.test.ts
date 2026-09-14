import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'
import { all_documents, read_document } from './ai-document-fixture'
import { document_scan } from './document-scan'

// Every `pnpm josh <x>` a document names in a code span has to be a real command. A per-rule marker
// suite used to pin a handful of command names by hand; this checks all of them at once, and a
// renamed or mistyped command fails here rather than at run time (joshuafolkken/kit#1923).

// `josh <x>` forms a document writes that are legitimately not COMMAND_MAP sub-commands: the
// workflow keywords a person types (`epicrun`, …), the built-in `help`, and `review`, which
// `chain-rule.md` names only to record a CLI wrapper that was investigated and rejected.
const KNOWN_EXTRA_COMMANDS: ReadonlyArray<string> = [
	'kickoff',
	'fullrun',
	'halfrun',
	'epicrun',
	'backlogrun',
	'diag',
	'help',
	'review',
]

const KNOWN_COMMANDS: ReadonlySet<string> = new Set([
	...Object.keys(COMMAND_MAP),
	...Object.keys(ALIASES),
	...KNOWN_EXTRA_COMMANDS,
])

function unknown_commands(text: string): Array<string> {
	return document_scan.command_references(text).filter((name) => !KNOWN_COMMANDS.has(name))
}

describe('every josh command a document names exists', () => {
	it.each(all_documents())('%s references only real commands', (path) => {
		expect(unknown_commands(read_document(path))).toStrictEqual([])
	})

	// The guard is only worth keeping if it fails on the thing it exists to catch.
	it('flags a command that is not in the map', () => {
		expect(unknown_commands('run `pnpm josh bogus-xyz` first')).toStrictEqual(['bogus-xyz'])
	})

	it('accepts a real command and its alias', () => {
		expect(unknown_commands('`pnpm josh gate` then `josh rh`')).toStrictEqual([])
	})
})

// The command reference must stay in step with the command map both ways: every command has a
// section, and no section documents a command that no longer exists (joshuafolkken/kit#1929). A
// section is a heading whose code span names the command, so a grouped heading
// (`` `josh run:hold` / `josh run:release` ``) covers each command it names.
const COMMAND_DOC = 'docs/josh-commands.md'

function documented_commands(): Set<string> {
	const headings = read_document(COMMAND_DOC)
		.split('\n')
		.filter((line) => /^#{2,4} /u.test(line))
	const names = new Set<string>()

	for (const heading of headings) {
		for (const name of document_scan.command_references(heading)) names.add(name)
	}

	return names
}

describe('the command reference covers exactly the command map', () => {
	it('gives every command map entry a section', () => {
		const documented = documented_commands()
		const missing = Object.keys(COMMAND_MAP).filter((name) => !documented.has(name))

		expect(missing).toStrictEqual([])
	})

	it('documents no section for a command that does not exist', () => {
		const unknown: Array<string> = []

		for (const name of documented_commands()) if (!KNOWN_COMMANDS.has(name)) unknown.push(name)

		expect(unknown).toStrictEqual([])
	})
})
