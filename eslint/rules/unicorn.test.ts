import { describe, expect, it } from 'vitest'
import { PREVENT_ABBR_ALLOW_LIST, unicorn_rules } from './unicorn.js'

interface PreventAbbrOptions {
	allowList: Record<string, boolean>
}

function get_prevent_abbreviations_rule(): [string, PreventAbbrOptions] {
	return unicorn_rules['unicorn/prevent-abbreviations'] as [string, PreventAbbrOptions]
}

describe('unicorn_rules — prevent-abbreviations allowList (issue #435)', () => {
	it('applies the shared allowList to the project-wide rule at error severity', () => {
		const [severity, options] = get_prevent_abbreviations_rule()

		expect(severity).toBe('error')
		expect(options.allowList).toBe(PREVENT_ABBR_ALLOW_LIST)
	})

	it('allows idiomatic short identifiers plus Props', () => {
		expect(PREVENT_ABBR_ALLOW_LIST).toMatchObject({
			Props: true,
			e: true,
			el: true,
			ctx: true,
			btn: true,
			idx: true,
			opts: true,
			params: true,
			args: true,
		})
	})

	it('includes e2e so Playwright page.e2e.ts filenames are not flagged', () => {
		expect(PREVENT_ABBR_ALLOW_LIST.e2e).toBe(true)
	})
})

describe('unicorn_rules — filename-case directory checking (regression #528)', () => {
	it('disables checkDirectories so directory names are never enforced', () => {
		const rule_value = unicorn_rules['unicorn/filename-case'] as [
			string,
			{ case: string; checkDirectories: boolean },
		]
		const [severity, options] = rule_value

		expect(severity).toBe('error')
		expect(options.case).toBe('kebabCase')
		expect(options.checkDirectories).toBe(false)
	})
})
