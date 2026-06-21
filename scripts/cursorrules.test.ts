import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const CURSORRULES_PATH = fileURLToPath(new URL('../.cursorrules', import.meta.url))

function load_cursorrules(): string {
	return readFileSync(CURSORRULES_PATH, 'utf8')
}

// The generated consumer package.json has no `check` / `lint` / `test` / `cspell:dot`
// scripts — they run through the `josh` command runner. Bare `pnpm run check` etc.
// would fail, so the distributed .cursorrules must reference the josh variants.
const CANONICAL_COMMANDS: ReadonlyArray<string> = [
	'pnpm josh check',
	'pnpm josh lint',
	'pnpm josh cspell:dot',
	'pnpm josh test',
	'pnpm josh test:unit',
]

const FORBIDDEN_COMMANDS: ReadonlyArray<string> = [
	'pnpm run check',
	'pnpm run lint',
	'pnpm run test',
	'pnpm cspell:dot',
	'pnpm test:unit',
]

describe('.cursorrules — canonical josh commands', () => {
	it.each(CANONICAL_COMMANDS)('references canonical command %s', (command) => {
		expect(load_cursorrules()).toContain(command)
	})

	it.each(FORBIDDEN_COMMANDS)('does not reference non-existent script %s', (command) => {
		expect(load_cursorrules()).not.toContain(command)
	})
})
