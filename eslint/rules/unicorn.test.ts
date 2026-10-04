import { Linter } from 'eslint'
import unicorn from 'eslint-plugin-unicorn'
import { describe, expect, it } from 'vitest'
import { NAME_REPLACEMENTS_ALLOW_LIST, unicorn_rules } from './unicorn.js'

const NO_EMPTY_FILE = 'unicorn/no-empty-file'

interface NameReplacementsOptions {
	allowList: Record<string, boolean>
}

function get_name_replacements_rule(): [string, NameReplacementsOptions] {
	return unicorn_rules['unicorn/name-replacements'] as [string, NameReplacementsOptions]
}

describe('unicorn_rules — name-replacements allowList (issue #435)', () => {
	it('applies the shared allowList to the project-wide rule at error severity', () => {
		const [severity, options] = get_name_replacements_rule()

		expect(severity).toBe('error')
		expect(options.allowList).toBe(NAME_REPLACEMENTS_ALLOW_LIST)
	})

	it('allows idiomatic short identifiers plus Props', () => {
		expect(NAME_REPLACEMENTS_ALLOW_LIST).toMatchObject({
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
		expect(NAME_REPLACEMENTS_ALLOW_LIST.e2e).toBe(true)
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

// The `sv create` scaffold ships `src/lib/index.ts` as a single comment line, so an untouched
// project must lint clean while a truly empty file is still reported (issue #3069).
function lint_empty_file_rule(code: string): ReadonlyArray<string> {
	const linter = new Linter({ configType: 'flat' })
	const config: Linter.Config = {
		files: ['**/*.ts'],
		plugins: { unicorn },
		rules: { [NO_EMPTY_FILE]: unicorn_rules[NO_EMPTY_FILE] as Linter.RuleEntry },
	}

	return linter.verify(code, [config], 'index.ts').map((message) => String(message.ruleId))
}

describe('unicorn_rules — no-empty-file on a comment-only file (regression #3069)', () => {
	it('accepts a file that holds only a comment', () => {
		expect(
			lint_empty_file_rule('// place files you want to import through the `#lib` alias\n'),
		).toEqual([])
	})

	it('still reports a file with no content at all', () => {
		expect(lint_empty_file_rule('\n')).toEqual([NO_EMPTY_FILE])
	})
})

// Regression guard for the unicorn-68 migration (issue #599): a configured rule that the
// installed plugin has renamed/removed (e.g. prevent-abbreviations → name-replacements,
// better-regex removed, no-instanceof-array → no-instanceof-builtins) breaks the distributed
// eslint config. Asserting every configured rule still exists and is not deprecated would have
// caught all three breakages and catches future upstream deprecations on the next dependency bump.
function find_rule_problem(key: string): string | undefined {
	const rule = unicorn.rules?.[key.replace('unicorn/', '')]
	if (rule === undefined) return `${key} (missing)`
	if (rule.meta?.deprecated) return `${key} (deprecated)`

	return undefined
}

describe('unicorn_rules — installed plugin compatibility', () => {
	it('configures only rules that exist and are not deprecated in the installed plugin', () => {
		const problems = Object.keys(unicorn_rules)
			.map((key) => find_rule_problem(key))
			.filter((entry) => entry !== undefined)

		expect(problems).toEqual([])
	})
})
