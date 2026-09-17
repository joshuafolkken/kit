import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
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
//
// **joshuafolkken/kit#1454 added a third claim: the limit and the counting options are the project's
// own.** They are resolved by `effective-limit.ts`, which is stubbed here so these tests keep spawning
// nothing — what a real consumer configuration produces is pinned end to end in
// `effective-limit.test.ts`, against a fixture rather than a sibling checkout.

const execa_mock = vi.hoisted(() => vi.fn())
const options_mock = vi.hoisted(() => vi.fn())

vi.mock('execa', () => ({ execa: execa_mock }))
vi.mock('./effective-limit', () => ({
	effective_limit: { options_for: options_mock, options_in: vi.fn() },
}))

const { line_budget } = await import('./line-budget')

const MAX_LINES_RULE = 'max-lines'
const PROJECT_ROOT_PREFIX = 'josh-line-budget-'
const SHIM_RELATIVE = path.join('node_modules', '.bin', 'eslint')
const REPO_FILE = '/repo/a.ts'

// The rule entry a project's own eslint resolves to, standing in for kit's here: nothing in
// `line-budget.ts` reads kit's copy any more, so the tests must not either.
const LIMIT = 300
const OPTIONS = { max: LIMIT, skipBlankLines: true, skipComments: true }
const CACHE_LOCATION = '--cache-location'
const THRESHOLD = line_budget.near_limit_threshold(LIMIT)

const rule_entry_schema = z.tuple([z.string(), z.looseObject({ max: z.number() })])
const probe_schema = z.record(z.string(), rule_entry_schema)

const ROOTS: Array<string> = []

function cache_location_of(key: string, root: string): string {
	const probe_args = line_budget.probe_arguments({ key, options: OPTIONS, paths: [] }, root)

	return probe_args[probe_args.indexOf(CACHE_LOCATION) + 1] ?? ''
}

// Every present path resolves to one limit unless a test says otherwise, which is what the single
// grouped probe below assumes.
function resolve_to(options: Record<string, unknown>): void {
	options_mock.mockImplementation(
		async (file_paths: ReadonlyArray<string>) =>
			new Map(file_paths.map((file_path) => [path.resolve(file_path), options])),
	)
}

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
	options_mock.mockReset()
	resolve_to(OPTIONS)
})

describe('line_budget.probe_rule — the project’s own rule, changed only in the limit', () => {
	it('keeps every resolved option and lowers only max', () => {
		const probed = probe_schema.parse(JSON.parse(line_budget.probe_rule(OPTIONS)))[MAX_LINES_RULE]

		expect(probed?.[1]).toEqual({ ...OPTIONS, max: 0 })
	})

	// The counting method is `skipBlankLines` / `skipComments`, and it is forwarded rather than
	// restated: a project that turns either off is counted its way, which is the half of
	// joshuafolkken/kit#1454 that is about the count rather than the limit.
	it('forwards a project’s own counting options rather than kit’s', () => {
		const raw = { max: 400, skipBlankLines: false, skipComments: false }
		const probed = probe_schema.parse(JSON.parse(line_budget.probe_rule(raw)))[MAX_LINES_RULE]

		expect(probed?.[1]).toEqual({ ...raw, max: 0 })
	})
})

describe('line_budget.probe_arguments', () => {
	it('asks for JSON, names the paths, and points the cache away from the tree', () => {
		const root = make_root()
		const probe_args = line_budget.probe_arguments(
			{ key: 'k', options: OPTIONS, paths: ['a.ts', 'b.ts'] },
			root,
		)
		const cache_location = probe_args[probe_args.indexOf(CACHE_LOCATION) + 1] ?? ''

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

	// eslint deletes whatever `--cache-location` names when it starts without `--cache`, and this call
	// can now run two probes at once — so one shared path would have them unlinking each other's file
	// (joshuafolkken/kit#1454).
	it('gives each counting method a cache path of its own', () => {
		const root = make_root()

		expect(cache_location_of('one', root)).not.toBe(cache_location_of('two', root))
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
		expect(entry?.budget?.headroom).toBe(LIMIT - 268)
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

// joshuafolkken/kit#1454: what the report says is decided by the entry the *project's* eslint
// resolved, and by nothing this package configures for itself.
describe('line_budget.budgets_for — the project’s own limit decides the report', () => {
	// The limit is the resolved one, so a consumer that raises it is reported against its own number
	// and never against kit's 300 (joshuafolkken/kit#1454).
	it('reports the limit the project resolved, not a limit of its own', async () => {
		const root = make_root()
		const target = write_source(root, 'big.ts', 12)

		resolve_to({ max: 400, skipBlankLines: true, skipComments: true })
		execa_mock.mockResolvedValue(eslint_reply([[target, 268]]))

		const [entry] = await line_budget.budgets_for([target], root)

		expect(entry?.budget?.limit).toBe(400)
		expect(entry?.limit).toBe(400)
	})

	// A path the project sets no `max-lines` on has nothing to subtract a count from, so it is never
	// probed and never given a budget — the alternative being to quote kit's limit for it.
	it('leaves a path with no resolved limit unbudgeted, and never probes it', async () => {
		const root = make_root()
		const target = write_source(root, 'unlimited.ts', 12)

		options_mock.mockResolvedValue(new Map())

		const [entry] = await line_budget.budgets_for([target], root)

		expect(entry?.limit).toBeUndefined()
		expect(entry?.budget).toBeUndefined()
		expect(execa_mock).not.toHaveBeenCalled()
	})
})

// One eslint run per distinct counting method, because two files counted differently cannot share one
// `--rule` override — and one run per *path* is the cost this report is written to avoid.
describe('line_budget.budgets_for — one probe per counting method', () => {
	it('spawns once per distinct option set and no more', async () => {
		const root = make_root()
		const skipped = write_source(root, 'skipped.ts', 12)
		const raw = write_source(root, 'raw.ts', 12)

		options_mock.mockResolvedValue(
			new Map([
				[path.resolve(skipped), OPTIONS],
				[path.resolve(raw), { max: LIMIT, skipBlankLines: false, skipComments: false }],
			]),
		)
		execa_mock.mockResolvedValue(eslint_reply([[skipped, 10]]))

		await line_budget.budgets_for([skipped, raw], root)

		expect(execa_mock).toHaveBeenCalledTimes(2)
	})

	// Two config blocks stating the same options in a different order are one counting method, so they
	// are one probe. Grouping on the raw JSON would split them and pay for a second eslint process on a
	// purely cosmetic difference.
	it('groups option sets that differ only in key order as one', async () => {
		const root = make_root()
		const first = write_source(root, 'first.ts', 12)
		const second = write_source(root, 'second.ts', 12)

		options_mock.mockResolvedValue(
			new Map([
				[path.resolve(first), { max: LIMIT, skipBlankLines: true, skipComments: true }],
				[path.resolve(second), { skipComments: true, skipBlankLines: true, max: LIMIT }],
			]),
		)
		execa_mock.mockResolvedValue(eslint_reply([[first, 10]]))

		await line_budget.budgets_for([first, second], root)

		expect(execa_mock).toHaveBeenCalledTimes(1)
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
	it('puts the warning a little under two functions from the limit', () => {
		expect(THRESHOLD).toBe(Math.ceil(LIMIT * line_budget.NEAR_LIMIT_FRACTION))
	})

	// The share is what a report with no single limit states the boundary as, so it has to be the same
	// fraction the line count is derived from rather than a second number beside it.
	it('states the same boundary as a share of whatever the limit is', () => {
		expect(line_budget.near_limit_percent()).toBe(85)
		expect(line_budget.near_limit_threshold(400)).toBe(340)
	})

	it('is near the limit at the threshold and not one line below it', () => {
		expect(line_budget.budget_of(THRESHOLD, LIMIT).is_near_limit).toBe(true)
		expect(line_budget.budget_of(THRESHOLD - 1, LIMIT).is_near_limit).toBe(false)
	})

	// Floored, not rounded: at 254/300 rounding prints `85%` while the advice starts at 255, and the
	// documentation tells the reader that 85% is where "near the limit" begins.
	it('never prints a percentage its own advice disagrees with', () => {
		expect(line_budget.describe(line_budget.budget_of(THRESHOLD - 1, LIMIT))).toContain('(84%)')
		expect(line_budget.describe(line_budget.budget_of(THRESHOLD, LIMIT))).toContain('(85%)')
	})

	it('describes headroom, and being over it, in the same phrasing', () => {
		expect(line_budget.describe(line_budget.budget_of(THRESHOLD, LIMIT))).toContain(
			`${String(THRESHOLD)}/${String(LIMIT)} code lines`,
		)
		expect(line_budget.describe(line_budget.budget_of(LIMIT + 2, LIMIT))).toContain('2 over')
	})

	it('advises a split at the threshold, and says nothing below it', () => {
		expect(line_budget.advice(line_budget.budget_of(THRESHOLD, LIMIT))).toContain('Step 0')
		expect(line_budget.advice(line_budget.budget_of(LIMIT + 1, LIMIT))).toContain('over the limit')
		expect(line_budget.advice(line_budget.budget_of(THRESHOLD - 1, LIMIT))).toBeUndefined()
	})
})
