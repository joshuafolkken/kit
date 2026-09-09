import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { effective_limit } from './effective-limit'
import { line_budget } from './line-budget'
import { lines_command } from './lines-command'

// joshuafolkken/kit#1454. The defect these tests pin is invisible in kit itself: the count came from
// the project's own eslint while the limit came from kit's `eslint/rules/code-quality.js`, and in this
// repository those are the same 300. It only shows in a consumer whose config overrides `max-lines`.
//
// **So the consumer is a fixture here, never a sibling checkout.** Pointing at a real app-kit or
// game-kit tree would make the suite depend on a machine's layout and on that project's current
// config; a fixture states the overriding configuration in the test that reads it. It is written under
// `node_modules/` because everything there is already outside this repository's own lint, spell check,
// vitest collection and git — so a run that dies before its cleanup cannot leave a file that breaks the
// gate. Module resolution still walks up from it to this repository's `node_modules/eslint`, which is
// exactly the lookup a real consumer performs against its own.
//
// **The numbers are code lines, and the fixture is built so that nothing else can pass.** The source is
// seven physical lines of which three are code; a test satisfied by `wc -l` would read 7 and fail here
// (`CLAUDE.md` → "Quality limits", joshuafolkken/kit#1070).

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
const FIXTURE_ROOT = path.join(
	REPO_ROOT,
	'node_modules',
	`.josh-lines-fixture-${String(process.pid)}`,
)
const NO_ESLINT_PREFIX = 'josh-lines-no-eslint-'

// Spawning eslint against a cold configuration is seconds, not milliseconds.
const PROBE_TIMEOUT_MS = 120_000

const CONSUMER_LIMIT = 400
const CODE_LINES = 3
const SKIPPED = 'skipped.js'
const RAW = 'raw.js'
const UNLIMITED = 'unlimited.js'
const INTEGER = 'integer.js'
const INTEGER_LIMIT = 200

// A comment and two blank lines the default counting keeps and this project's own options throw away.
const SOURCE = ['// a comment', '', 'const a = 1', 'const b = 2', '', 'const c = 3', ''].join('\n')

// Three blocks, because the limit this command reports is per file rather than per project: a flat
// config can key an override on a `files` pattern, and a report that resolved one number for the whole
// call would be wrong about whichever group it did not pick.
function config_source(): string {
	const max = `max: ${String(CONSUMER_LIMIT)}`

	return [
		'export default [',
		`\t{ files: ['**/*.js'], rules: { 'max-lines': ['error', { ${max}, skipBlankLines: true, skipComments: true }] } },`,
		`\t{ files: ['**/${RAW}'], rules: { 'max-lines': ['error', { ${max}, skipBlankLines: false, skipComments: false }] } },`,
		`\t{ files: ['**/${UNLIMITED}'], rules: { 'max-lines': 'off' } },`,
		`\t{ files: ['**/${INTEGER}'], rules: { 'max-lines': ['error', ${String(INTEGER_LIMIT)}] } },`,
		']',
		'',
	].join('\n')
}

function fixture(name: string): string {
	return path.join(FIXTURE_ROOT, name)
}

beforeAll(() => {
	mkdirSync(FIXTURE_ROOT, { recursive: true })
	writeFileSync(fixture('eslint.config.js'), config_source(), 'utf8')

	for (const name of [SKIPPED, RAW, UNLIMITED, INTEGER]) {
		writeFileSync(fixture(name), SOURCE, 'utf8')
	}
})

afterAll(() => {
	rmSync(FIXTURE_ROOT, { recursive: true, force: true })
})

describe('effective_limit.options_in', () => {
	it('reads the max out of the entry the project’s config resolved to', () => {
		expect(effective_limit.options_in({ rules: { 'max-lines': [2, { max: 400 }] } })?.max).toBe(400)
	})

	// A rule that is off enforces nothing, so there is no limit to subtract a count from. Both
	// spellings are refused: `calculateConfigForFile` normalizes severity to a number, and a config
	// read by any other route can still carry the word.
	it('answers nothing for a rule that is turned off, in either spelling', () => {
		expect(
			effective_limit.options_in({ rules: { 'max-lines': [0, { max: 400 }] } }),
		).toBeUndefined()
		expect(
			effective_limit.options_in({ rules: { 'max-lines': ['off', { max: 400 }] } }),
		).toBeUndefined()
	})

	it('answers nothing where the rule is absent or carries no max', () => {
		expect(effective_limit.options_in({ rules: {} })).toBeUndefined()
		expect(effective_limit.options_in({ rules: { 'max-lines': ['error'] } })).toBeUndefined()
	})

	// eslint's own schema for `max-lines` is `oneOf: [integer, object]`, so `['error', 200]` is a
	// configuration a consumer really writes — and a bare `'max-lines': 'error'` reaches here as
	// `[2, 300]`, because the rule declares `defaultOptions: [300]` and eslint fills it in. Refusing
	// either spelling reports "no limit" for a file the gate fails on, which is joshuafolkken/kit#1454
	// again in a different disguise.
	it('reads the bare integer spelling, with the skips the rule then applies', () => {
		expect(effective_limit.options_in({ rules: { 'max-lines': [2, 200] } })).toEqual({
			max: 200,
			skipBlankLines: false,
			skipComments: false,
		})
	})
})

describe('effective_limit.options_for — the consumer’s own eslint answers', () => {
	it(
		'reports the limit that project’s config sets, not kit’s',
		async () => {
			const options = await effective_limit.options_for([fixture(SKIPPED)], FIXTURE_ROOT)

			expect(options.get(fixture(SKIPPED))?.max).toBe(CONSUMER_LIMIT)
		},
		PROBE_TIMEOUT_MS,
	)

	// Never kit's number as a fallback: that is the defect this file exists to remove, and a silent
	// fallback would restore it in exactly the case nobody can see.
	it('answers nothing at all where there is no eslint to ask', async () => {
		const root = mkdtempSync(path.join(tmpdir(), NO_ESLINT_PREFIX))
		const options = await effective_limit.options_for([path.join(root, 'a.js')], root)

		rmSync(root, { recursive: true, force: true })

		expect(options.size).toBe(0)
	})

	it('spawns nothing and loads nothing when asked about no paths', async () => {
		const options = await effective_limit.options_for([], FIXTURE_ROOT)

		expect(options.size).toBe(0)
	})
})

describe('line_budget.budgets_for — end to end against a consumer configuration', () => {
	it(
		'reports the consumer’s limit and the headroom left against it',
		async () => {
			const [entry] = await line_budget.budgets_for([fixture(SKIPPED)], FIXTURE_ROOT)

			expect(entry?.budget).toEqual({
				code_lines: CODE_LINES,
				limit: CONSUMER_LIMIT,
				headroom: CONSUMER_LIMIT - CODE_LINES,
				is_near_limit: false,
			})
		},
		PROBE_TIMEOUT_MS,
	)

	// The counting options travel with the limit, so two files of identical text are counted
	// differently when the project says they are. Taking these from kit while taking the count from the
	// project is the same defect wearing a different number.
	it(
		'counts each file the way that file’s own options say',
		async () => {
			const [skipped, raw] = await line_budget.budgets_for(
				[fixture(SKIPPED), fixture(RAW)],
				FIXTURE_ROOT,
			)

			expect(skipped?.budget?.code_lines).toBe(CODE_LINES)
			expect(raw?.budget?.code_lines).toBeGreaterThan(CODE_LINES)
		},
		PROBE_TIMEOUT_MS,
	)
})

describe('line_budget.budgets_for — the bare integer spelling of the rule', () => {
	// `['error', 200]` is a configuration eslint accepts and a consumer writes. The limit is that 200,
	// and because the integer form carries no skip options the rule counts every physical line — so the
	// count here must be larger than the same text counted with kit's skips.
	it(
		'reports that limit, counted the way the integer spelling counts',
		async () => {
			const [entry] = await line_budget.budgets_for([fixture(INTEGER)], FIXTURE_ROOT)

			expect(entry?.budget?.limit).toBe(INTEGER_LIMIT)
			expect(entry?.budget?.code_lines).toBeGreaterThan(CODE_LINES)
		},
		PROBE_TIMEOUT_MS,
	)
})

describe('line_budget.budgets_for — a path the consumer sets no limit on', () => {
	it(
		'reports no budget for it rather than borrowing kit’s limit',
		async () => {
			const [entry] = await line_budget.budgets_for([fixture(UNLIMITED)], FIXTURE_ROOT)

			expect(entry?.limit).toBeUndefined()
			expect(entry?.budget).toBeUndefined()
		},
		PROBE_TIMEOUT_MS,
	)
})

describe('lines_command — what a consumer’s report says', () => {
	it(
		'prints the consumer’s limit and threshold in the header, never kit’s',
		async () => {
			const budgets = await line_budget.budgets_for([fixture(SKIPPED)], FIXTURE_ROOT)

			expect(lines_command.header(budgets)).toBe(
				`limit ${String(CONSUMER_LIMIT)} code lines · near from ${String(
					line_budget.near_limit_threshold(CONSUMER_LIMIT),
				)}`,
			)
		},
		PROBE_TIMEOUT_MS,
	)

	it(
		'says a path with no limit is not counted rather than printing a number',
		async () => {
			const budgets = await line_budget.budgets_for([fixture(UNLIMITED)], FIXTURE_ROOT)

			expect(lines_command.rows_for(budgets, FIXTURE_ROOT)[0]).toContain(lines_command.NO_LIMIT)
		},
		PROBE_TIMEOUT_MS,
	)
})
