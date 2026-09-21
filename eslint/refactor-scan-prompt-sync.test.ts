import { fileURLToPath } from 'node:url'
import { read_repo_file } from '#scripts/document/ai-document-fixture'
import { refactor_lint } from '#scripts/refactor/refactor-lint'
import { describe, expect, it } from 'vitest'
import { create_base_config } from './base.js'

// joshuafolkken/kit#2255: `refactor:scan`'s CATEGORIES and the prompt that documents them drifted —
// `local/namespace-object-export` existed as a rule but was never queried, so the oracle answered
// `clear` without ever reading it. Prose cannot be linted, so this suite reads the rule list out of
// the oracle and pins it against the prompt: a rule added to one and not the other fails here rather
// than letting the verdict quietly narrow again.

const REFACTORING_PROMPT = 'prompts/refactoring.md'
// The bold header uniquely marks the candidate-aggregation bullet; the section intro cites the same
// words unbolded, so matching the bold form keeps this pinned to the one line that enumerates rules.
const SCAN_BULLET_MARKER = '**候補の集計**'
const BACKTICK_TOKEN = /`([^`]+)`/gu
// A rule id has no spaces and is one or two slash-separated segments; `pnpm josh gate` (spaces) and
// `file:line` (a colon) are the other backtick tokens near the bullet and neither matches this shape.
const RULE_ID_SHAPE = /^(?:@?[\w-]+\/)?[\w-]+$/u

const CATEGORY_RULES: ReadonlyArray<string> = refactor_lint.CATEGORIES.flatMap(
	(category) => category.rules,
)

function scan_bullet(): string {
	const line = read_repo_file(REFACTORING_PROMPT)
		.split('\n')
		.find((candidate) => candidate.includes(SCAN_BULLET_MARKER))

	if (line === undefined) {
		throw new Error(`${REFACTORING_PROMPT} has no candidate-aggregation bullet`)
	}

	return line
}

function bullet_rule_ids(): ReadonlyArray<string> {
	return [...scan_bullet().matchAll(BACKTICK_TOKEN)]
		.map((match) => match[1] ?? '')
		.filter((token) => RULE_ID_SHAPE.test(token))
}

function configured_rule_names(): ReadonlySet<string> {
	const config = create_base_config({
		gitignore_path: new URL('../.gitignore', import.meta.url),
		tsconfig_root_dir: fileURLToPath(new URL('..', import.meta.url)),
	})

	return new Set(config.flatMap((block) => Object.keys(block.rules ?? {})))
}

const CONFIGURED_RULES = configured_rule_names()

describe('refactor:scan CATEGORIES and the prompt stay in sync', () => {
	it.each(CATEGORY_RULES)('the prompt names the queried rule %s', (rule) => {
		expect(read_repo_file(REFACTORING_PROMPT)).toContain(`\`${rule}\``)
	})

	it.each(bullet_rule_ids())('the prompt claims no rule the oracle skips: %s', (rule) => {
		expect(CATEGORY_RULES).toContain(rule)
	})
})

describe('every queried rule is a real eslint rule', () => {
	it.each(CATEGORY_RULES)('%s is configured in the base eslint config', (rule) => {
		expect(CONFIGURED_RULES.has(rule)).toBe(true)
	})
})
