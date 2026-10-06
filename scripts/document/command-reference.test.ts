import { readFileSync } from 'node:fs'
import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'
import { all_documents, COMMAND_REFERENCE_DOCS, read_document } from './ai-document-fixture'
import { document_scan } from './document-scan'
import { CATALOG_FILE, generate_catalog } from './generate-catalog'

// Every `pnpm josh <x>` a document names in a code span has to be a real command. A per-rule marker
// suite used to pin a handful of command names by hand; this checks all of them at once, and a
// renamed or mistyped command fails here rather than at run time (joshuafolkken/kit#1923).

// `josh <x>` forms a document writes that are legitimately not COMMAND_MAP sub-commands: the
// workflow keywords a person types (`prrun`, …), the built-in `help`, and `review`, which
// `chain-rule.md` names only to record a CLI wrapper that was investigated and rejected.
const KNOWN_EXTRA_COMMANDS: ReadonlyArray<string> = [
	'kickoff',
	'fullrun',
	'halfrun',
	'prrun',
	'backlogrun',
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
		expect(unknown_commands('`pnpm josh gate` then `josh ga`')).toStrictEqual([])
	})

	// An alias retired with joshuafolkken/kit#2906 is no longer a command a document may name.
	it('flags a retired automation alias', () => {
		expect(unknown_commands('then `josh rh`')).toStrictEqual(['rh'])
	})

	// `epicrun` was retired in favour of `backlogrun #E --only`; `prrun` is a current keyword.
	it('flags the retired epicrun keyword and accepts prrun', () => {
		expect(unknown_commands('`josh epicrun` or `josh prrun`')).toStrictEqual(['epicrun'])
	})
})

// The command reference must stay in step with the command map both ways: every command has a
// section, and no section documents a command that no longer exists (joshuafolkken/kit#1929). A
// section is a heading whose code span names the command, so a grouped heading
// (`` `josh run:hold` / `josh run:release` ``) covers each command it names.
// The reference is two pages — the commands a person types, and the ones automation calls
// (joshuafolkken/kit#2998) — and together they cover the map.
function documented_commands(paths: ReadonlyArray<string> = COMMAND_REFERENCE_DOCS): Set<string> {
	const headings = paths
		.map((path) => read_document(path))
		.join('\n')
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

// A command's audience decides its page: the commands a person types (`developer`) are documented on
// the developer reference and nowhere else, and every other command stays off it — so the audience
// the catalog prints and the page a reader is sent to cannot disagree (joshuafolkken/kit#3278).
const DEVELOPER_REFERENCE = 'docs/josh-commands.md'

function developer_commands(): Array<string> {
	return Object.entries(COMMAND_MAP)
		.filter(([, entry]) => entry.reference[1] === 'developer')
		.map(([name]) => name)
}

describe('the audience decides the reference page', () => {
	it('documents every developer command on the developer reference', () => {
		const documented = documented_commands([DEVELOPER_REFERENCE])

		expect(developer_commands().filter((name) => !documented.has(name))).toStrictEqual([])
	})

	it('documents no other command on the developer reference', () => {
		const developer = new Set(developer_commands())
		const misplaced = [...documented_commands([DEVELOPER_REFERENCE])].filter(
			(name) => Object.hasOwn(COMMAND_MAP, name) && !developer.has(name),
		)

		expect(misplaced).toStrictEqual([])
	})

	it('documents no developer command on an automation page', () => {
		const others = COMMAND_REFERENCE_DOCS.filter((path) => path !== DEVELOPER_REFERENCE)
		const documented = documented_commands(others)

		expect(developer_commands().filter((name) => documented.has(name))).toStrictEqual([])
	})

	it.each(['latest', 'latest:corepack', 'latest:update', 'overrides'])(
		'treats %s as a command a person types',
		(name) => {
			expect(developer_commands()).toContain(name)
		},
	)
})

describe('the command catalog is up to date', () => {
	const catalog = generate_catalog()

	it('matches the command map', () => {
		const on_disk = readFileSync(CATALOG_FILE, 'utf8')

		expect(on_disk).toBe(catalog)
	})

	it('covers every command in the map', () => {
		const missing = Object.keys(COMMAND_MAP).filter((name) => !catalog.includes(`\`josh ${name}\``))

		expect(missing).toStrictEqual([])
	})
})
