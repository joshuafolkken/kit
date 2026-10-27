import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { rename_identifier, type RenameRequest } from './rename-identifier'

// joshuafolkken/kit#5236: the writer split of joshuafolkken/kit#5202 (PR #5221) renamed `lane_ledger`
// to `lane_ledger_write` and its specifier in 22 files, one Edit at a time.

const FILE = 'core-wait-record.ts'
const LEDGER_RENAME: RenameRequest = {
	old_name: 'lane_ledger',
	new_name: 'lane_ledger_write',
	specifier: ['#scripts/lane/lane-ledger', '#scripts/lane/lane-ledger-write'],
}
const BARE_RENAME: RenameRequest = { old_name: 'old', new_name: 'renamed' }

// `core-wait-record.ts` and `git-followup-stages.ts` as they stood before PR #5221, the two files the
// Issue names, folded into one fixture.
const BEFORE = `import { lane_ledger } from '#scripts/lane/lane-ledger'

async function to_ledger(wait: CoreWaitRecord): Promise<void> {
	await lane_ledger.record_core_wait(wait)
}

async function record_ci_wait(wait: Wait): Promise<void> {
	await lane_ledger.record_stage({
		stage: lane_ledger.CI_WAIT_STAGE,
		elapsed_ms: wait.duration_ms,
	})
}
`
// The same lines as PR #5221 left them.
const AFTER = `import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'

async function to_ledger(wait: CoreWaitRecord): Promise<void> {
	await lane_ledger_write.record_core_wait(wait)
}

async function record_ci_wait(wait: Wait): Promise<void> {
	await lane_ledger_write.record_stage({
		stage: lane_ledger_write.CI_WAIT_STAGE,
		elapsed_ms: wait.duration_ms,
	})
}
`

function renamed(text: string, request: RenameRequest = BARE_RENAME): string {
	return rename_identifier.rewrite(ts, FILE, text, request).text
}

describe('rename_identifier.rewrite — the PR #5221 rename', () => {
	it('produces the same lines as PR #5221', () => {
		expect(rename_identifier.rewrite(ts, FILE, BEFORE, LEDGER_RENAME)).toStrictEqual({
			text: AFTER,
			count: 5,
			is_taken: false,
		})
	})

	it('rewrites the specifier of a vi.mock and a dynamic import', () => {
		const text = "vi.mock('#scripts/lane/lane-ledger')\nawait import('#scripts/lane/lane-ledger')\n"

		expect(renamed(text, LEDGER_RENAME)).toBe(
			"vi.mock('#scripts/lane/lane-ledger-write')\nawait import('#scripts/lane/lane-ledger-write')\n",
		)
	})

	it('renames a type query, an interpolation and an export specifier', () => {
		const text = 'type Entry = typeof old.read\nconst line = `old ${old}`\nexport { old }\n'

		expect(renamed(text)).toBe(
			'type Entry = typeof renamed.read\nconst line = `old ${renamed}`\nexport { renamed }\n',
		)
	})

	it('reports a file that already binds the new name, but not one holding it as a key', () => {
		const taken = 'const renamed = 1\nfunction read(old) { return old + renamed }\n'
		const keyed = 'const old = 1\nconst value = { renamed: other.renamed }\n'

		expect(rename_identifier.rewrite(ts, FILE, taken, BARE_RENAME).is_taken).toBe(true)
		expect(rename_identifier.rewrite(ts, FILE, keyed, BARE_RENAME).is_taken).toBe(false)
	})

	it('counts nothing in a file without the identifier or the specifier', () => {
		expect(rename_identifier.rewrite(ts, FILE, 'const other = 1\n', LEDGER_RENAME).count).toBe(0)
	})
})

describe('rename_identifier.rewrite — leaves what is not a binding', () => {
	it('keeps a string literal holding the name or the specifier', () => {
		const text = "const label = 'old'\nconst path = '#scripts/lane/lane-ledger'\n"

		expect(renamed(text, { ...BARE_RENAME, specifier: LEDGER_RENAME.specifier })).toBe(text)
	})

	it('keeps a line comment and a doc comment', () => {
		const text = '// old is renamed\n/** old */\nconst value = 1\n'

		expect(renamed(text)).toBe(text)
	})

	it('keeps a property access and a property key naming another value', () => {
		expect(renamed('const old = 1\nconst value = { old: other.old }\n')).toBe(
			'const renamed = 1\nconst value = { old: other.old }\n',
		)
	})

	it('keeps the key of a shorthand property and a shorthand destructuring', () => {
		expect(renamed('const { old } = source\nconst value = { old }\n')).toBe(
			'const { old: renamed } = source\nconst value = { old: renamed }\n',
		)
	})

	it('renames an object rest element without a key', () => {
		expect(renamed('const { a, ...old } = source\nuse(old)\n')).toBe(
			'const { a, ...renamed } = source\nuse(renamed)\n',
		)
	})

	it('keeps a destructured key and a method name', () => {
		const text = 'const { old: alias } = source\nclass Item { old(): void {} }\n'

		expect(renamed(text)).toBe(text)
	})
})
