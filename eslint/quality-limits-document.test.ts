import { fileURLToPath } from 'node:url'
import { CANONICAL_DOC, read_repo_file } from '#scripts/ai-document-fixture'
import { describe, expect, it } from 'vitest'
import { create_base_config } from './base.js'
import { code_quality_rules } from './rules/code-quality.js'
import { sonarjs_rules } from './rules/sonarjs.js'

// joshuafolkken/kit#1070: the documented quality limits and the rules that enforce them drifted
// apart twice over, and both drifts read as compliance rather than as a failure.
//
// The first drift is the counting method. `max-lines` runs with `skipBlankLines` and `skipComments`,
// so "file ≤300 lines" describes code lines while a reader measures with `wc -l`; the gap is not
// noise in a repository whose comments run to paragraphs — `scripts/init/init-logic.ts` passes at
// 453 physical lines. Three files were split on this limit in one session, each time by an author
// who could not predict where the tool would object.
//
// The second drift is the numbers themselves. Three distributed documents restate the limits, and
// two of them had the same three wrong — complexity ≤4, nesting ≤1, params ≤3 — so a reader
// following either flagged code the gate accepts, while `max-statements` and
// `sonarjs/cognitive-complexity` were enforced without appearing in any of them.
//
// Prose cannot be linted, so the guard is this suite: every number a document states is read back
// out of the rule object that enforces it, and the skip options are pinned so that flipping one
// fails here rather than silently making the documented counting method a lie.
//
// It lives in `eslint/` rather than `eslint/rules/` because it reads both halves of the
// configuration — the rule objects and the tests-block override in `base.js` — and a suite under
// `rules/` could not import the latter without a banned parent-relative import.

const REVIEW_PROMPT = 'prompts/review.md'
const REFACTORING_PROMPT = 'prompts/refactoring.md'
const CODING_STANDARDS = 'prompts/coding-standards.md'

const COGNITIVE_COMPLEXITY = 'sonarjs/cognitive-complexity'
const MAX_LINES = 'max-lines'
const MAX_LINES_PER_FUNCTION = 'max-lines-per-function'
const SKIP_BLANK_LINES = 'skipBlankLines'
const SKIP_COMMENTS = 'skipComments'
const EMPTY = ''

// The limit is substituted into each phrase rather than written beside it, so a document and this
// suite cannot state different numbers while both look maintained.
const PLACEHOLDER = '<n>'
const DIGIT_AT_START = /^\d/u

// The two rules whose unit of measure is a line, and therefore the only two the counting method
// applies to. Both must skip the same things, or "code lines" describes one of them and not the
// other.
const LINE_COUNTING_RULES: ReadonlyArray<string> = [MAX_LINES, MAX_LINES_PER_FUNCTION]

// The tests block raises the per-function limit above what everything else gets. The documents state
// the exception in prose, so the figure is read back out of the built config.
const TEST_FILE_PATTERN = '*.test.ts'
const TEST_LINES_PER_FUNCTION = 35

const COUNTING_LINE_MARKER = 'line counts are code lines'
const NOT_PHYSICAL = 'not physical lines'

interface LineRuleOptions {
	max: number
	skipBlankLines: boolean
	skipComments: boolean
}

type RuleSet = Readonly<Record<string, unknown>>

// One document's restatement of the limits: where the block starts, how it words each rule, and how
// it words the tests-block exception. The phrasings are written out rather than generated — a suite
// that generated them would pass against a document nobody can read — and they differ per document
// because two of the three are in Japanese.
interface DocumentSpec {
	path: string
	marker: string
	phrases: Readonly<Record<string, string>>
	test_override: string
}

const ENGLISH_PHRASES: Readonly<Record<string, string>> = {
	complexity: `function complexity ≤${PLACEHOLDER}`,
	'max-depth': `nesting ≤${PLACEHOLDER}`,
	[MAX_LINES_PER_FUNCTION]: `function ≤${PLACEHOLDER} lines`,
	[MAX_LINES]: `file ≤${PLACEHOLDER} lines`,
	'max-params': `params ≤${PLACEHOLDER}`,
	'max-statements': `statements per function ≤${PLACEHOLDER}`,
	[COGNITIVE_COMPLEXITY]: `cognitive complexity ≤${PLACEHOLDER}`,
}

const JAPANESE_PHRASES: Readonly<Record<string, string>> = {
	complexity: `関数の複雑度**: 最大${PLACEHOLDER}`,
	'max-depth': `ネストレベル**: 最大${PLACEHOLDER}`,
	[MAX_LINES_PER_FUNCTION]: `関数の行数**: 最大${PLACEHOLDER}行`,
	[MAX_LINES]: `ファイルの行数**: 最大${PLACEHOLDER}行`,
	'max-params': `パラメータ数**: 最大${PLACEHOLDER}個`,
	'max-statements': `関数内の文の数**: 最大${PLACEHOLDER}`,
	[COGNITIVE_COMPLEXITY]: `認知的複雑度**: 最大${PLACEHOLDER}`,
}

const ENGLISH_OVERRIDE = `${String(TEST_LINES_PER_FUNCTION)} code lines`

const DOCUMENT_SPECS: ReadonlyArray<DocumentSpec> = [
	{
		path: CANONICAL_DOC,
		marker: 'Function complexity ≤',
		phrases: ENGLISH_PHRASES,
		test_override: ENGLISH_OVERRIDE,
	},
	{
		path: REVIEW_PROMPT,
		marker: '**Quality limits**:',
		phrases: ENGLISH_PHRASES,
		test_override: ENGLISH_OVERRIDE,
	},
	{
		path: CODING_STANDARDS,
		marker: '### 複雑度制限',
		phrases: JAPANESE_PHRASES,
		test_override: `テストファイルは${String(TEST_LINES_PER_FUNCTION)}行`,
	},
]

// `prompts/refactoring.md` states the limits as a search checklist rather than a table, so it is
// pinned on the option names alone. It is a mandatory Completion-gate step: left unguarded it went
// on telling readers to split at 300 physical lines while the gate counted code lines.
const COUNTING_DOCUMENTS: ReadonlyArray<string> = [
	...DOCUMENT_SPECS.map((spec) => spec.path),
	REFACTORING_PROMPT,
]

const ENGLISH_DOCUMENTS: ReadonlyArray<string> = [CANONICAL_DOC, REVIEW_PROMPT]

function rule_entry(rules: RuleSet, name: string): ReadonlyArray<unknown> {
	const entry = rules[name]
	if (!Array.isArray(entry)) throw new Error(`${name} is not configured as [severity, options]`)

	return entry as ReadonlyArray<unknown>
}

// A limit is a bare number (`complexity: ['error', 5]`) or the `max` of an options object
// (`max-lines: ['error', { max: 300, ... }]`). Reading both shapes here is what lets the tables above
// name a rule rather than repeat its value.
function configured_limit(rules: RuleSet, name: string): number {
	const [, options] = rule_entry(rules, name)
	if (typeof options === 'number') return options

	return (options as LineRuleOptions).max
}

function rules_for(name: string): RuleSet {
	return name === COGNITIVE_COMPLEXITY ? sonarjs_rules : code_quality_rules
}

function stated_form(spec: DocumentSpec, name: string): string {
	const phrase = spec.phrases[name]
	if (phrase === undefined) throw new Error(`${spec.path} has no phrasing for ${name}`)

	const limit = String(configured_limit(rules_for(name), name))

	return phrase.split(PLACEHOLDER).join(limit)
}

function line_rule_options(name: string): LineRuleOptions {
	const [, options] = rule_entry(code_quality_rules, name)

	return options as LineRuleOptions
}

function tests_block_options(): LineRuleOptions {
	const config = create_base_config({
		gitignore_path: new URL('../.gitignore', import.meta.url),
		tsconfig_root_dir: fileURLToPath(new URL('..', import.meta.url)),
	})
	const block = config.find(
		(candidate) =>
			Array.isArray(candidate.files) &&
			candidate.files.some((pattern) => String(pattern).includes(TEST_FILE_PATTERN)),
	)

	return rule_entry(block?.rules ?? {}, MAX_LINES_PER_FUNCTION)[1] as LineRuleOptions
}

// The block a document states its limits in: the marker line and everything up to the blank line
// that ends the list it introduces. Matching against the whole document instead would let a number
// written anywhere else satisfy the assertion — the failure mode a sibling suite already hit
// (joshuafolkken/kit#966).
function is_bullet(line: string): boolean {
	return line.startsWith('-')
}

// The list ends at the first blank line that follows a bullet: a heading marker is separated from
// its own list by one, so the blank has to be ignored until the list has actually started.
function ends_block(line: string, block: ReadonlyArray<string>): boolean {
	return line.trim() === EMPTY && block.some((seen) => is_bullet(seen))
}

function block_from(lines: ReadonlyArray<string>): string {
	const block: Array<string> = []

	for (const line of lines) {
		if (ends_block(line, block)) break
		block.push(line)
	}

	return block.join('\n')
}

function limits_block(document_path: string, marker: string): string {
	const lines = read_repo_file(document_path).split('\n')
	const start = lines.findIndex((line) => line.includes(marker))
	if (start === -1) return EMPTY

	return block_from(lines.slice(start)).toLowerCase()
}

function find_line(document_path: string, marker: string): string {
	const line = read_repo_file(document_path)
		.split('\n')
		.find((candidate) => candidate.includes(marker))

	return line ?? EMPTY
}

// A document drifting to `params ≤40` still contains `params ≤4`, so the character after the match
// has to be a non-digit. Without it the five suffix-less limits were pinned to their first digit
// only.
function states(block: string, stated: string): boolean {
	return block
		.split(stated.toLowerCase())
		.slice(1)
		.some((rest) => !DIGIT_AT_START.test(rest))
}

describe.each(DOCUMENT_SPECS)('$path states the limits the rules enforce', (spec) => {
	const block = limits_block(spec.path, spec.marker)

	it('has a limits block to read', () => {
		expect(block).not.toBe(EMPTY)
	})

	it.each(Object.keys(ENGLISH_PHRASES))('states %s', (name) => {
		expect(states(block, stated_form(spec, name))).toBe(true)
	})

	it('states the raised limit test files get', () => {
		expect(read_repo_file(spec.path)).toContain(spec.test_override)
	})
})

// Read line-scoped for the reason the block is: matched against the whole document, an option name
// surviving anywhere else keeps this green after the sentence that explains it has gone.
describe.each(COUNTING_DOCUMENTS)('%s names the options that do the skipping', (document_path) => {
	const line = find_line(document_path, SKIP_BLANK_LINES)

	it('names skipBlankLines', () => {
		expect(line).toContain(SKIP_BLANK_LINES)
	})

	it('names skipComments beside it', () => {
		expect(line).toContain(SKIP_COMMENTS)
	})
})

describe.each(ENGLISH_DOCUMENTS)('%s spells the counting method out', (document_path) => {
	it('says the counts are not physical lines', () => {
		expect(find_line(document_path, COUNTING_LINE_MARKER)).toContain(NOT_PHYSICAL)
	})
})

// The other half of the pin: the documents claim blank lines and comments are not counted, and that
// claim is only true while both options stay on. Flipping one has to fail here, where the message
// names the document to rewrite, rather than in a lint run whose report looks like ordinary debt.
describe.each(LINE_COUNTING_RULES)('%s counts code lines only', (name) => {
	const options = line_rule_options(name)

	it('skips blank lines', () => {
		expect(options.skipBlankLines).toBe(true)
	})

	it('skips comments', () => {
		expect(options.skipComments).toBe(true)
	})
})

describe('the tests block raises the per-function limit the documents describe', () => {
	const options = tests_block_options()

	it('raises it to the stated figure', () => {
		expect(options.max).toBe(TEST_LINES_PER_FUNCTION)
	})

	it('counts those lines the same way the default limit does', () => {
		expect(options.skipBlankLines).toBe(true)
		expect(options.skipComments).toBe(true)
	})
})
