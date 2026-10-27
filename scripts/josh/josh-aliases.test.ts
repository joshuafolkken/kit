import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canonical_command } from './josh-aliases'

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// Each module that reads only a leaf, and the hub it must not import: importing the hub would carry
// every module it imports into each test that reaches the reader (joshuafolkken/kit#5128).
const COMMAND_TABLE = 'josh-command-map'
const CORE_BUDGET = 'core-budget'
const LEAF_READERS: ReadonlyArray<{ reader: string; hub: string }> = [
	{ reader: 'scripts/time-runtime/time-shell.ts', hub: COMMAND_TABLE },
	{ reader: 'scripts/time-runtime/time-bundle-call.ts', hub: COMMAND_TABLE },
	{ reader: 'scripts/gate/gate-plan.ts', hub: CORE_BUDGET },
	{ reader: 'scripts/josh/josh-commands-ai.ts', hub: CORE_BUDGET },
	{ reader: 'scripts/josh/josh-commands-development.ts', hub: CORE_BUDGET },
]

function imports_hub(reader: string, hub: string): boolean {
	const source = readFileSync(path.join(PACKAGE_DIR, reader), 'utf8')

	return new RegExp(`from '[^']*/${hub}'`, 'u').test(source)
}

describe('canonical_command', () => {
	it('expands an alias to its command', () => {
		expect(canonical_command('ga')).toBe('gate')
	})

	it('passes a command name through unchanged', () => {
		expect(canonical_command('gate')).toBe('gate')
	})

	it('passes a name spelled like an Object.prototype member through unchanged', () => {
		expect(canonical_command('constructor')).toBe('constructor')
	})
})

describe('leaf readers', () => {
	it.each(LEAF_READERS)('$reader does not import $hub', ({ reader, hub }) => {
		expect(imports_hub(reader, hub)).toBe(false)
	})
})
