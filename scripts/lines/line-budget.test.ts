import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { code_quality_rules } from '#eslint/rules/code-quality.js'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

// joshuafolkken/kit#1425. Two claims are pinned here, and they are the two a headroom report can
// quietly break.
//
// **The first is that nothing counts lines locally.** `max-lines` runs with `skipBlankLines` and
// `skipComments`, so the number is neither `wc -l` nor anything derivable from the text without a
// parser (joshuafolkken/kit#1070) — and a second counting method is how a limit comes to be satisfied
// by counting differently rather than by splitting. So the count is asked of the project's own eslint,
// and the tests below pin that the invocation differs from `pnpm josh lint`'s in exactly one option.
//
// **The second is that it is the eslint _CLI_ that is asked.** Running the same rule through
// `new Linter().verify()` or `new ESLint().lintFiles()` answers **one line lower on any file starting
// with `#!`** — measured on eslint 10.10.0 against this repository's own config, 300 from either API
// where the CLI, and therefore the gate, says 301. Every `scripts/*.ts` entry point has a hashbang, so
// the in-process route would have been wrong for most of this package. `probe_command` is asserted to
// spawn a binary for that reason, not for tidiness.

const execa_mock = vi.hoisted(() => vi.fn())

vi.mock('execa', () => ({ execa: execa_mock }))

const { line_budget } = await import('./line-budget')

const MAX_LINES_RULE = 'max-lines'
const PROJECT_ROOT_PREFIX = 'josh-line-budget-'
const SHIM_RELATIVE = path.join('node_modules', '.bin', 'eslint')
const REPO_FILE = '/repo/a.ts'

const rule_entry_schema = z.tuple([z.string(), z.looseObject({ max: z.number() })])
const probe_schema = z.record(z.string(), rule_entry_schema)

const ROOTS: Array<string> = []

function make_root(): string {
	const root = mkdtempSync(path.join(tmpdir(), PROJECT_ROOT_PREFIX))

	ROOTS.push(root)

	return root
}

// A file whose *physical* size is nothing like the number eslint will be made to report, so a test
// that passed by accidentally counting the text would fail here.
function write_source(root: string, name: string, physical_lines: number): string {
	const target = path.join(root, name)

	const body = Array.from(
		{ length: physical_lines },
		(_, index) => `const v${String(index)} = ${String(index)}`,
	)

	writeFileSync(target, `${body.join('\n')}\n`, 'utf8')

	return target
}

function eslint_reply(entries: ReadonlyArray<[string, number]>): { stdout: string } {
	return {
		stdout: JSON.stringify(
			entries.map(([file_path, code_lines]) => ({
				filePath: file_path,
				messages: [
					{ ruleId: 'no-console', message: 'Unexpected console statement.' },
					{
						ruleId: MAX_LINES_RULE,
						message: `File has too many lines (${String(code_lines)}). Maximum allowed is 0.`,
					},
				],
			})),
		),
	}
}

afterAll(() => {
	for (const root of ROOTS) rmSync(root, { recursive: true, force: true })
})

beforeEach(() => {
	execa_mock.mockReset()
})

describe('line_budget.probe_rule — the project’s own rule, changed only in the limit', () => {
	it('keeps every configured option and lowers only max', () => {
		const [, configured] = rule_entry_schema.parse(code_quality_rules[MAX_LINES_RULE])
		const probed = probe_schema.parse(JSON.parse(line_budget.probe_rule()))[MAX_LINES_RULE]

		expect(probed?.[1]).toEqual({ ...configured, max: 0 })
	})

	// The counting method is `skipBlankLines` / `skipComments`, and it is asserted through the
	// configured object rather than restated: a config that turned either off would still agree here,
	// and a probe that hard-coded them would not.
	it('reports the configured limit rather than a number of its own', () => {
		const [, configured] = rule_entry_schema.parse(code_quality_rules[MAX_LINES_RULE])

		expect(line_budget.configured_limit()).toBe(configured.max)
	})
})

describe('line_budget.probe_arguments', () => {
	it('asks for JSON, names the paths, and points the cache away from the tree', () => {
		const root = make_root()
		const probe_args = line_budget.probe_arguments(['a.ts', 'b.ts'], root)
		const cache_location = probe_args[probe_args.indexOf('--cache-location') + 1] ?? ''

		expect(probe_args).toEqual(expect.arrayContaining(['--format', 'json', 'a.ts', 'b.ts']))
		// A location is named but caching is not asked for: eslint deletes whatever `--cache-location`
		// points at when `--cache` is absent, and the default is the gate's own `.eslintcache`
		// (joshuafolkken/kit#1332). It must therefore be somewhere outside the tree.
		// An inline `/* eslint-disable max-lines */` beats the `--rule` override, so without this flag the
		// probe would see no message and read a 500-line file as 0 code lines with 300 to spare — the one
		// direction this report must never be wrong in.
		expect(probe_args).toContain('--no-inline-config')
		expect(probe_args).not.toContain('--cache')
		expect(cache_location).not.toBe('')
		expect(cache_location.startsWith(root)).toBe(false)
	})
})

describe('line_budget.is_lintable_path', () => {
	it('accepts a regular file and refuses a directory or a path that is gone', () => {
		const root = make_root()

		expect(line_budget.is_lintable_path(write_source(root, 'real.ts', 2))).toBe(true)
		expect(line_budget.is_lintable_path(root)).toBe(false)
		expect(line_budget.is_lintable_path(path.join(root, 'gone.ts'))).toBe(false)
	})
})

describe('line_budget.probe_command — the CLI, never an in-process linter', () => {
	it('uses the project’s own eslint shim when it is there', () => {
		const root = make_root()
		const shim = path.join(root, SHIM_RELATIVE)

		mkdirSync(path.dirname(shim), { recursive: true })
		writeFileSync(shim, '', { mode: 0o755 })

		expect(line_budget.probe_command(root, ['--format'])[0]).toBe(shim)
	})

	it('falls back to pnpm exec where there is no shim', () => {
		expect(line_budget.probe_command(make_root(), ['--format'])).toEqual([
			'pnpm',
			'exec',
			'eslint',
			'--format',
		])
	})
})

describe('line_budget.parse_counts', () => {
	it('reads the count out of the rule’s own message, keyed by absolute path', () => {
		const counts = line_budget.parse_counts(eslint_reply([[REPO_FILE, 268]]).stdout)

		expect(counts.get(path.resolve(REPO_FILE))).toBe(268)
	})

	it('leaves out a path eslint refused', () => {
		// Written as text rather than built from an object: `ruleId` is `null` in eslint's own JSON for
		// an ignore warning, and that null is the shape being pinned.
		const raw = '[{"filePath":"/repo/ignored.ts","messages":[{"ruleId":null,"message":"ignored"}]}]'

		expect(line_budget.parse_counts(raw).size).toBe(0)
	})

	// The rule reports only above its `max`, and 0 is the lowest `max` its schema takes — so a file
	// whose counted code lines are 0 produces no message. With `skipBlankLines` / `skipComments` that
	// is a comments-only module as much as an empty one, and 0 is an answer rather than a refusal.
	it('reads a linted file with no max-lines message as zero code lines', () => {
		const raw =
			'[{"filePath":"/repo/comments.ts","messages":[{"ruleId":"unicorn/no-empty-file","message":"Empty files are not allowed."}]}]'

		expect(line_budget.parse_counts(raw).get(path.resolve('/repo/comments.ts'))).toBe(0)
	})

	it('answers nothing at all for output it could not parse', () => {
		expect(line_budget.parse_counts('truncated {').size).toBe(0)
	})
})

describe('line_budget.budgets_for', () => {
	it('reports the number eslint gave, not the size of the file', async () => {
		const root = make_root()
		const target = write_source(root, 'big.ts', 12)

		execa_mock.mockResolvedValue(eslint_reply([[target, 268]]))

		const [entry] = await line_budget.budgets_for([target], root)

		expect(entry?.budget?.code_lines).toBe(268)
		expect(entry?.budget?.headroom).toBe(line_budget.configured_limit() - 268)
	})

	it('answers nothing for a path that is not there, and never passes it to eslint', async () => {
		const root = make_root()
		const missing = path.join(root, 'gone.ts')
		const present = write_source(root, 'here.ts', 3)

		execa_mock.mockResolvedValue(eslint_reply([[present, 10]]))

		const budgets = await line_budget.budgets_for([missing, present], root)

		expect(budgets[0]?.budget).toBeUndefined()
		expect(execa_mock.mock.calls[0]?.[1]).not.toContain(missing)
	})

	it('spawns nothing when no path exists', async () => {
		const root = make_root()

		expect(await line_budget.budgets_for([path.join(root, 'gone.ts')], root)).toHaveLength(1)
		expect(execa_mock).not.toHaveBeenCalled()
	})
})

// Every path asked about shares one eslint run, which is what keeps the report's cost at one process
// start — and what makes a single unusable argument able to take the whole call down with it.
describe('line_budget.budgets_for — one bad argument must not answer for the rest', () => {
	// One argument eslint cannot match makes it exit with no JSON at all, and every path in the call
	// shares that one run — so a directory would take the answers for its neighbors down with it.
	it('never passes a directory to eslint, and still answers for its neighbors', async () => {
		const root = make_root()
		const present = write_source(root, 'here.ts', 3)

		execa_mock.mockResolvedValue(eslint_reply([[present, 10]]))

		const budgets = await line_budget.budgets_for([root, present], root)

		expect(execa_mock.mock.calls[0]?.[1]).not.toContain(root)
		expect(budgets[0]?.budget).toBeUndefined()
		expect(budgets[1]?.budget?.code_lines).toBe(10)
	})

	it('answers nothing when the spawn produced no usable output', async () => {
		const root = make_root()
		const target = write_source(root, 'here.ts', 3)

		execa_mock.mockResolvedValue({ stdout: 'not json at all' })

		const budgets = await line_budget.budgets_for([target], root)

		expect(budgets[0]?.budget).toBeUndefined()
	})
})

describe('line_budget — the threshold and how it reads', () => {
	const LIMIT = line_budget.configured_limit()
	const THRESHOLD = line_budget.near_limit_threshold()

	it('puts the warning a little under two functions from the limit', () => {
		expect(THRESHOLD).toBe(Math.ceil(LIMIT * line_budget.NEAR_LIMIT_FRACTION))
	})

	it('is near the limit at the threshold and not one line below it', () => {
		expect(line_budget.budget_of(THRESHOLD).is_near_limit).toBe(true)
		expect(line_budget.budget_of(THRESHOLD - 1).is_near_limit).toBe(false)
	})

	// Floored, not rounded: at 254/300 rounding prints `85%` while the advice starts at 255, and the
	// documentation tells the reader that 85% is where "near the limit" begins.
	it('never prints a percentage its own advice disagrees with', () => {
		expect(line_budget.describe(line_budget.budget_of(THRESHOLD - 1))).toContain('(84%)')
		expect(line_budget.describe(line_budget.budget_of(THRESHOLD))).toContain('(85%)')
	})

	it('describes headroom, and being over it, in the same phrasing', () => {
		expect(line_budget.describe(line_budget.budget_of(THRESHOLD))).toContain(
			`${String(THRESHOLD)}/${String(LIMIT)} code lines`,
		)
		expect(line_budget.describe(line_budget.budget_of(LIMIT + 2))).toContain('2 over')
	})

	it('advises a split at the threshold, and says nothing below it', () => {
		expect(line_budget.advice(line_budget.budget_of(THRESHOLD))).toContain('Step 0')
		expect(line_budget.advice(line_budget.budget_of(LIMIT + 1))).toContain('over the limit')
		expect(line_budget.advice(line_budget.budget_of(THRESHOLD - 1))).toBeUndefined()
	})
})
