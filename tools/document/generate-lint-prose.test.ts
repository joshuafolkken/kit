import { readFileSync } from 'node:fs'
import { code_quality_rules, code_quality_test_rules } from '#eslint/rules/code-quality.js'
import { JAPANESE_RATIONALE_DIRECTORY } from '#eslint/rules/english-only-prose.js'
import { sonarjs_rules } from '#eslint/rules/sonarjs.js'
import { refactor_lint } from '#scripts/refactor/refactor-lint'
import { generate_command_usage } from '#tools/document/generate-command-usage'
import { generate_lint_prose } from '#tools/document/generate-lint-prose'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

const STALE_SPAN = 'Limits: <!-- lint: line-counting -->`max-lines`<!-- /lint -->.\n'
const MAX_LINES = 'max-lines'
const MUTABLE_RULES: Record<string, unknown> = code_quality_rules
const ORIGINAL_MAX_LINES = MUTABLE_RULES[MAX_LINES]
const CATEGORY_RULES = refactor_lint.CATEGORIES.flatMap((category) => category.rules)

const MAX_OPTION = z.tuple([z.string(), z.object({ max: z.number() })])

function max_of(entry: unknown): string {
	return String(MAX_OPTION.parse(entry)[1].max)
}

function expected_limits(): Array<string> {
	return [
		`Function complexity ≤${String(code_quality_rules.complexity[1])}`,
		`nesting ≤${String(code_quality_rules['max-depth'][1])}`,
		`function ≤${max_of(code_quality_rules['max-lines-per-function'])} lines`,
		`file ≤${max_of(code_quality_rules[MAX_LINES])} lines`,
		`params ≤${String(code_quality_rules['max-params'][1])}`,
		`statements per function ≤${String(code_quality_rules['max-statements'][1])}`,
		`cognitive complexity ≤${String(sonarjs_rules['sonarjs/cognitive-complexity'][1])}`,
	]
}

function page_text(page: string): string {
	return readFileSync(generate_command_usage.page_path(page), 'utf8')
}

function expect_page_current(text: string): void {
	const message = `the lint prose spans are stale — run \`${generate_lint_prose.REGENERATE_COMMAND}\``

	expect(generate_lint_prose.fill_lint_spans(text), message).toBe(text)
}

afterEach(() => {
	MUTABLE_RULES[MAX_LINES] = ORIGINAL_MAX_LINES
})

describe('generate lint prose', () => {
	it('fills a span from the rule objects and keeps the prose around it', () => {
		expect(generate_lint_prose.fill_lint_spans(STALE_SPAN)).toBe(
			'Limits: <!-- lint: line-counting -->`max-lines` / `max-lines-per-function`<!-- /lint -->.\n',
		)
	})

	it('states every limit the lint config enforces, with the tests-block exception', () => {
		const filled = generate_lint_prose.fill_lint_spans(
			'<!-- lint: quality-limits --><!-- /lint -->',
		)

		expect(filled).toContain(`<!-- lint: quality-limits -->${expected_limits().join(' · ')} — `)
		expect(filled).toContain(
			`test functions allow ${max_of(code_quality_test_rules['max-lines-per-function'])} code lines`,
		)
	})

	it('refuses to call a limit code lines when its rule counts blank lines', () => {
		MUTABLE_RULES[MAX_LINES] = ['error', { max: 300, skipBlankLines: false, skipComments: true }]

		expect(() => generate_lint_prose.fill_lint_spans(STALE_SPAN)).toThrow(
			'`max-lines` must skip blank lines and comments',
		)
	})

	it('refuses a span no renderer is registered for', () => {
		expect(() => generate_lint_prose.fill_lint_spans('<!-- lint: nope --><!-- /lint -->')).toThrow(
			'no lint prose is registered for `nope`',
		)
	})
})

describe('generate lint prose from the refactor and English-only configs', () => {
	it('lists every refactor:scan rule and marks only the low-priority category', () => {
		const filled = generate_lint_prose.fill_lint_spans(
			'<!-- lint: refactor-scan-rules --><!-- /lint -->',
		)

		for (const rule of CATEGORY_RULES) expect(filled).toContain(`\`${rule}\``)

		expect(filled).toContain('unused code（低優先度: `@typescript-eslint/no-unused-vars`）')
		expect(filled.match(/低優先度/gu)).toHaveLength(1)
	})

	it('names the directory the English-only rule is switched off for', () => {
		expect(
			generate_lint_prose.fill_lint_spans('<!-- lint: english-only-exemption --><!-- /lint -->'),
		).toBe(`<!-- lint: english-only-exemption -->\`${JAPANESE_RATIONALE_DIRECTORY}\`<!-- /lint -->`)
	})
})

describe('the lint prose pages are current', () => {
	it.each(generate_lint_prose.LINT_PROSE_PAGES)('%s matches the lint config', (page) => {
		expect_page_current(page_text(page))
	})

	it('renders every registered span on some page', () => {
		const spans = generate_lint_prose.LINT_PROSE_PAGES.flatMap((page) =>
			generate_lint_prose.lint_spans(page_text(page)),
		)

		expect(new Set(spans)).toStrictEqual(new Set(Object.keys(generate_lint_prose.RENDERERS)))
	})

	it('names the regeneration command when a page is stale', () => {
		expect(() => {
			expect_page_current(STALE_SPAN)
		}).toThrow('run `pnpm josh command:derive`')
	})
})
