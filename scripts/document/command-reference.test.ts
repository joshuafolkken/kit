import { readFileSync } from 'node:fs'
import { ALIASES } from '#scripts/josh/josh-aliases'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import {
	CATALOG_FILE,
	format_command_entry,
	generate_catalog,
	REGENERATE_COMMAND,
} from '#tools/document/generate-catalog'
import { describe, expect, it } from 'vitest'
import { all_documents, COMMAND_REFERENCE_DOCS, read_document } from './ai-document-fixture'
import { command_reference_line_budget } from './command-reference-line-budget'
import { document_scan } from './document-scan'

// Every documented `pnpm josh <x>` code span must name a real command, so renamed or mistyped
// commands fail before run time across the whole document set (joshuafolkken/kit#1923).

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

// A stale catalog's failure names the command that regenerates it (#4784).
function expect_catalog_current(on_disk: string, catalog: string): void {
	expect(on_disk, `the catalog is stale — run \`${REGENERATE_COMMAND}\``).toBe(catalog)
}

describe('the command catalog is up to date', () => {
	const catalog = generate_catalog()

	it('matches the command map', () => {
		expect_catalog_current(readFileSync(CATALOG_FILE, 'utf8'), catalog)
	})

	it('names the regeneration command when the catalog is stale', () => {
		expect(() => {
			expect_catalog_current('stale', catalog)
		}).toThrow('run `pnpm josh command:derive`')
	})

	it('names the same regeneration command in the catalog heading', () => {
		expect(catalog).toContain(`Run \`${REGENERATE_COMMAND}\` to regenerate.`)
	})

	it('covers every command in the map', () => {
		const missing = Object.keys(COMMAND_MAP).filter((name) => !catalog.includes(`\`josh ${name}\``))

		expect(missing).toStrictEqual([])
	})

	// A table row per command, not a section of ten lines each (#4162).
	it('gives every command exactly one table row', () => {
		const rows = catalog.split('\n').filter((line) => line.startsWith('| `josh '))

		expect(rows).toHaveLength(Object.keys(COMMAND_MAP).length)
	})

	it('renders a command as one row with its aliases and an escaped pipe', () => {
		const row = format_command_entry('gate', {
			category: 'Development',
			description: 'Run the checks',
			reference: ['[--a|--b]', 'developer', ['none']],
			usage: { examples: [] },
			script: 'gate.ts',
		})

		expect(row).toBe(
			'| `josh gate` · `josh ga` | `[--a\\|--b]` | developer | none | Run the checks |',
		)
	})
})

// The ceiling and the count are `command-reference-line-budget.ts`'s, shared with `josh lint:related`.
describe('the command reference keeps its entries short', () => {
	it('keeps at most the ratcheted number of lines over the length limit', () => {
		const { long_line_count, MAX_LONG_LINES } = command_reference_line_budget
		const count = long_line_count(COMMAND_REFERENCE_DOCS.map((path) => read_document(path)))

		expect(count).toBeLessThanOrEqual(MAX_LONG_LINES)
	})
})
