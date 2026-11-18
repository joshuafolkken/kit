import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { test_symbol_facts } from './test-symbol-facts'
import { test_symbol_users, type Source } from './test-symbol-users'
import { test_symbol_whole } from './test-symbol-whole'

const CARD = 'src/Card.svelte'
const CARD_TEST = 'src/Card.test.ts'
const LABEL = 'src/label.ts'
const CARD_TEXT = `<script>\n\timport { label } from './label'\n</script>\n<p>{label()}</p>\n`
const RELATIVE = './'

// `./Card.svelte` names its file, `./label` its `.ts`.
function resolve(specifier: string): string | undefined {
	if (!specifier.startsWith(RELATIVE)) return undefined
	const written = `src/${specifier.slice(RELATIVE.length)}`

	return written.endsWith('.svelte') ? written : `${written}.ts`
}

describe('test_symbol_whole.is_whole', () => {
	it('reads a component whole and a script by its syntax', () => {
		expect(test_symbol_whole.is_whole(CARD)).toBe(true)
		expect(test_symbol_whole.is_whole(LABEL)).toBe(false)
	})
})

describe('test_symbol_whole.read_whole', () => {
	it('reads a component as one default export using every export of what it imports', () => {
		const facts = test_symbol_whole.read_whole(resolve, CARD, CARD_TEXT)
		const { DEFAULT_EXPORT, EVERY } = test_symbol_facts

		expect(facts.declarations.get(DEFAULT_EXPORT)).toEqual({
			start: 1,
			end: 5,
			references: new Set([test_symbol_facts.key_of(LABEL, EVERY)]),
		})
		expect(facts.exports.get(EVERY)).toBe(DEFAULT_EXPORT)
		expect(facts.modules).toEqual(new Set([LABEL]))
	})

	it('carries a change to an imported module on to the tests of the component', () => {
		const sources: Array<Source> = [
			{ file: LABEL, text: 'function label() { return 1 }\nexport { label }\n' },
			{ file: CARD, text: CARD_TEXT },
			{ file: CARD_TEST, text: `import Card from './Card.svelte'\nit('c', () => Card)\n` },
		]
		const index = test_symbol_users.build(ts, resolve, sources)
		const seeds = test_symbol_users.changed_keys(index, LABEL, [1])
		const reach = { max_hops: Infinity, stops: new Set<string>() }

		expect([...test_symbol_users.select(index, seeds, reach)]).toEqual([CARD_TEST])
	})
})
