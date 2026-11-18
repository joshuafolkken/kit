import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { test_registry_readers } from './test-registry-readers'

const REGISTRY = {
	file: 'scripts/josh/josh-commands-thing.ts',
	text: [
		'const THING_COMMANDS = {',
		`\t'thing:do': { run: do_thing },`,
		`\t'thing:undo': { run: undo_thing },`,
		'}',
		'',
	].join('\n'),
}

describe('test_registry_readers.is_registry', () => {
	it('matches a josh command registry and nothing else', () => {
		expect(test_registry_readers.is_registry(REGISTRY.file)).toBe(true)
		expect(test_registry_readers.is_registry('scripts/josh/josh-command-map.ts')).toBe(false)
	})
})

describe('test_registry_readers.changed_commands', () => {
	it('reads the keys of the entries a changed line falls in', () => {
		expect(test_registry_readers.changed_commands(ts, REGISTRY, [3])).toEqual(['thing:undo'])
	})

	it('reads no key for a line outside every entry', () => {
		expect(test_registry_readers.changed_commands(ts, REGISTRY, [5])).toEqual([])
	})
})

describe('test_registry_readers.readers_of', () => {
	const quoted = { file: 'quoted.test.ts', text: `run(['thing:do'])` }
	const line = { file: 'line.test.ts', text: 'exec(`pnpm josh thing:do --flag`)' }
	const tests = [quoted, line, { file: 'prefix.test.ts', text: `run('thing:do-more')` }]

	it('selects the tests naming the command as a string or a word of a command line', () => {
		expect(test_registry_readers.readers_of(['thing:do'], tests)).toEqual([quoted.file, line.file])
	})

	it('ignores a key that is no command name', () => {
		expect(test_registry_readers.readers_of(['a.b(c)'], tests)).toEqual([])
	})
})
