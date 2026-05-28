import { describe, expect, it } from 'vitest'
import { naming_convention_rules } from './naming-convention.js'

interface NamingSelector {
	selector: string
	format: ReadonlyArray<string> | null
	modifiers?: ReadonlyArray<string>
	types?: ReadonlyArray<string>
	filter?: { regex: string; match: boolean }
}

function get_selectors(): ReadonlyArray<NamingSelector> {
	// Drop the leading 'error' severity entry; the rest are selector configs.
	const rule = naming_convention_rules['@typescript-eslint/naming-convention']

	return rule.slice(1) as ReadonlyArray<NamingSelector>
}

function find_selector(
	predicate: (selector: NamingSelector) => boolean,
): NamingSelector | undefined {
	return get_selectors().find((selector) => predicate(selector))
}

describe('naming_convention_rules — typeProperty (issue #426 Gap 1)', () => {
	it('allows camelCase so inline type literals can model external DOM/API objects', () => {
		const selector = find_selector((entry) => entry.selector === 'typeProperty')

		expect(selector?.format).toEqual(['snake_case', 'camelCase'])
	})
})

describe('naming_convention_rules — objectLiteralProperty (issue #426 Gap 2)', () => {
	it('allows PascalCase for external key maps and component-name keys without dropping prior formats', () => {
		const selector = find_selector((entry) => entry.selector === 'objectLiteralProperty')

		expect(selector?.format).toEqual(['snake_case', 'UPPER_CASE', 'camelCase', 'PascalCase'])
	})
})

describe('naming_convention_rules — SvelteKit reserved page-option exports (issue #426 Gap 3)', () => {
	it('exempts ssr/csr/prerender/trailingSlash exported consts via a camelCase filter selector', () => {
		const selector = find_selector(
			(entry) =>
				entry.selector === 'variable' && entry.filter?.regex.includes('trailingSlash') === true,
		)

		expect(selector).toBeDefined()
		expect(selector?.modifiers).toEqual(['const', 'exported'])
		expect(selector?.filter).toEqual({
			regex: '^(ssr|csr|prerender|trailingSlash)$',
			match: true,
		})
		expect(selector?.format).toEqual(['camelCase'])
	})
})
