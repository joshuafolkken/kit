import { Linter } from 'eslint'
import unicorn from 'eslint-plugin-unicorn'
import { describe, expect, it } from 'vitest'
import { NAME_REPLACEMENTS_ALLOW_LIST, unicorn_rules } from './unicorn.js'

const NO_EMPTY_FILE = 'unicorn/no-empty-file'
const NAME_REPLACEMENTS = 'unicorn/name-replacements'

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

describe('unicorn_rules — documentation comment asterisks (issue #3273)', () => {
	it('keeps the conventional asterisk-prefixed JSDoc lines', () => {
		expect(unicorn_rules['unicorn/no-asterisk-prefix-in-documentation-comments']).toBe('off')
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

// Lints `code` with one rule exactly as `unicorn_rules` configures it; answers the reported rule ids.
function lint_with_rule(
	rule_name: keyof typeof unicorn_rules,
	code: string,
): ReadonlyArray<string> {
	const linter = new Linter({ configType: 'flat' })
	const config: Linter.Config = {
		files: ['**/*.ts'],
		plugins: { unicorn },
		rules: { [rule_name]: unicorn_rules[rule_name] as Linter.RuleEntry },
	}

	return linter.verify(code, [config], 'index.ts').map((message) => String(message.ruleId))
}

// The `sv create` scaffold ships `src/lib/index.ts` as a single comment line, so an untouched
// project must lint clean while a truly empty file is still reported (issue #3069).
describe('unicorn_rules — no-empty-file on a comment-only file (regression #3069)', () => {
	it('accepts a file that holds only a comment', () => {
		expect(
			lint_with_rule(NO_EMPTY_FILE, '// place files you want to import through the `#lib` alias\n'),
		).toEqual([])
	})

	it('still reports a file with no content at all', () => {
		expect(lint_with_rule(NO_EMPTY_FILE, '\n')).toEqual([NO_EMPTY_FILE])
	})
})

// unicorn 77 expands `repo` to `repository`; the allowList matches whole lowercase words only, so
// the replacement itself is disabled to cover `Repo` inside a PascalCase name too (issue #3273).
describe('unicorn_rules — name-replacements keeps repo (issue #3273)', () => {
	it('accepts repo as a word in snake_case and PascalCase names', () => {
		const code = 'export class RepoIdentity {}\nexport const current_repo = new RepoIdentity()\n'

		expect(lint_with_rule(NAME_REPLACEMENTS, code)).toEqual([])
	})

	it('still expands an unfamiliar abbreviation', () => {
		expect(lint_with_rule(NAME_REPLACEMENTS, 'export const req_count = 1\n')).toEqual([
			NAME_REPLACEMENTS,
		])
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
