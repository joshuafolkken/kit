import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
	LINT_RULE_CACHE_FILE,
	LINT_RULE_CACHE_FLAGS,
	LINT_RULE_DIRECTORY,
	LINT_RULE_PATHS_CACHE_FILE,
	LINT_RULE_PATHS_CACHE_FLAGS,
	LINT_RULE_WORKERS,
} from '#scripts/josh/josh-command-types'
import { FAIL_EXIT_CODE } from '#scripts/lib/buffered-process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./lint-parallel', () => ({ lint_parallel: { run_eslint: vi.fn() } }))

const { lint_parallel } = await import('./lint-parallel')
const { lint_rule } = await import('./lint-rule')
const mocked_run_eslint = vi.mocked(lint_parallel.run_eslint)

const RULE = 'kit/no-measurement-comment'
const OTHER_RULE = 'max-len'
const TEMPORARY_CONFIG = 'tmp.config.js'
const OUTPUT_FILE_FLAG = '--output-file'
const JSON_FILE = '/out.json'
const ESLINT_OUTPUT = 'eslint said this'
const DEFAULT_REPORT = `${LINT_RULE_DIRECTORY}/kit-no-measurement-comment.txt`
const PATHS_REPORT = `${LINT_RULE_DIRECTORY}/kit-no-measurement-comment.paths.txt`
const PATHS_FLAG = '--paths'
const FIRST_VIOLATION = 'scripts/a.ts:3:5'
const SUBSET = ['scripts/lint/lint-rule.ts', 'scripts/lint/lint-parallel.ts']
const ESLINT_FOUND_EXIT_CODE = 1
const ESLINT_FATAL_EXIT_CODE = 2
const FIRST_LINE = 3
const SECOND_LINE = 7
const COLUMN = 5

const fixture = { root: '' }

function message(rule_id: string | undefined, line: number): Record<string, unknown> {
	return { ruleId: rule_id, line, column: COLUMN, message: `${String(rule_id)} at ${String(line)}` }
}

function value_after(args: ReadonlyArray<string>, flag: string): string {
	return args[args.indexOf(flag) + 1] ?? ''
}

// The mocked eslint writes `report` where the arguments name the JSON output and exits `exit_code`.
function eslint_writes(
	report: string | undefined,
	exit_code: number = ESLINT_FOUND_EXIT_CODE,
): void {
	mocked_run_eslint.mockImplementation(async ({ args }) => {
		if (report !== undefined) writeFileSync(value_after(args, OUTPUT_FILE_FLAG), report)

		return { output: ESLINT_OUTPUT, exit_code, elapsed_ms: 0 }
	})
}

function two_file_report(): string {
	const { root } = fixture

	return JSON.stringify([
		{
			filePath: path.join(root, 'scripts/a.ts'),
			messages: [message(RULE, FIRST_LINE), message(OTHER_RULE, SECOND_LINE)],
		},
		{ filePath: path.join(root, 'scripts/b.ts'), messages: [message(RULE, SECOND_LINE)] },
		{ filePath: path.join(root, 'scripts/c.ts'), messages: [message(undefined, FIRST_LINE)] },
	])
}

function default_report(): string {
	return readFileSync(path.join(fixture.root, DEFAULT_REPORT), 'utf8')
}

beforeEach(() => {
	fixture.root = mkdtempSync(path.join(tmpdir(), 'lint-rule-'))
	vi.spyOn(process.stdout, 'write').mockReturnValue(true)
	vi.spyOn(process.stderr, 'write').mockReturnValue(true)
})

afterEach(() => {
	rmSync(fixture.root, { recursive: true, force: true })
	vi.restoreAllMocks()
	mocked_run_eslint.mockReset()
})

describe('lint_rule.parse_arguments', () => {
	it('reads the rule with no options', () => {
		expect(lint_rule.parse_arguments([RULE])).toStrictEqual({ rule: RULE })
	})

	it('reads --config and --output in either order', () => {
		expect(
			lint_rule.parse_arguments([RULE, '--output', 'out.txt', '--config', TEMPORARY_CONFIG]),
		).toStrictEqual({ rule: RULE, config: TEMPORARY_CONFIG, output: 'out.txt' })
	})

	it('reads every path after --paths, across repeats, beside the other options', () => {
		expect(
			lint_rule.parse_arguments([
				RULE,
				PATHS_FLAG,
				'a.ts',
				'b.ts',
				'--output',
				'o',
				PATHS_FLAG,
				'c',
			]),
		).toStrictEqual({ rule: RULE, output: 'o', paths: ['a.ts', 'b.ts', 'c'] })
	})

	it.each([
		['no rule', []],
		['a flag where the rule goes', ['--config', TEMPORARY_CONFIG]],
		['an option with no value', [RULE, '--output']],
		['an unknown option', [RULE, '--fix', 'yes']],
		['--paths with no value', [RULE, PATHS_FLAG]],
		['--paths followed by another flag', [RULE, PATHS_FLAG, '--output', 'o']],
		['two values for a single-value option', [RULE, '--output', 'a', 'b']],
	])('refuses %s', (_case, command_arguments) => {
		expect(lint_rule.parse_arguments(command_arguments)).toBeUndefined()
	})
})

describe('lint_rule.eslint_arguments', () => {
	it('lints the whole tree with the rule at error, in parallel, on its own cache, into JSON', () => {
		const args = lint_rule.eslint_arguments({ rule: RULE }, JSON_FILE)

		expect(args.slice(0, 3)).toStrictEqual(['exec', 'eslint', '.'])
		expect(value_after(args, '--concurrency')).toBe(String(LINT_RULE_WORKERS))
		expect(JSON.parse(value_after(args, '--rule'))).toStrictEqual({ [RULE]: 'error' })
		expect(value_after(args, '--format')).toBe('json')
		expect(value_after(args, OUTPUT_FILE_FLAG)).toBe(JSON_FILE)
		expect(args.slice(-LINT_RULE_CACHE_FLAGS.length)).toStrictEqual(LINT_RULE_CACHE_FLAGS)
		expect(args).not.toContain('--config')
	})

	it('passes a temporary config through', () => {
		const args = lint_rule.eslint_arguments({ rule: RULE, config: TEMPORARY_CONFIG }, JSON_FILE)

		expect(value_after(args, '--config')).toBe(TEMPORARY_CONFIG)
	})

	it('lints the --paths in place of the whole tree, on the subset cache', () => {
		const args = lint_rule.eslint_arguments({ rule: RULE, paths: SUBSET }, JSON_FILE)

		expect(args.slice(0, 4)).toStrictEqual(['exec', 'eslint', ...SUBSET])
		expect(args).not.toContain('.')
		expect(args.slice(-LINT_RULE_PATHS_CACHE_FLAGS.length)).toStrictEqual(
			LINT_RULE_PATHS_CACHE_FLAGS,
		)
	})
})

describe('lint_rule.run_lint_rule — a report', () => {
	it("writes only the rule's violations, relative to the root, and summarizes them", async () => {
		eslint_writes(two_file_report())

		await expect(lint_rule.run_lint_rule([RULE], fixture.root)).resolves.toBe(0)
		expect(default_report()).toBe(
			`scripts/a.ts:3:5  ${RULE} at 3\nscripts/b.ts:7:5  ${RULE} at 7\n`,
		)
		expect(process.stdout.write).toHaveBeenCalledWith(
			`lint:rule ${RULE} — 2 violations in 2 files → ${DEFAULT_REPORT}\n`,
		)
	})

	it('runs through the gate lint path on its own cache, cold', async () => {
		eslint_writes('[]', 0)

		await lint_rule.run_lint_rule([RULE], fixture.root)

		expect(mocked_run_eslint).toHaveBeenCalledWith(
			expect.objectContaining({ cache_file: LINT_RULE_CACHE_FILE, warm_daemon: false }),
		)
	})

	it('writes an empty list and exits 0 when nothing violates the rule', async () => {
		eslint_writes('[]', 0)

		await expect(lint_rule.run_lint_rule([RULE], fixture.root)).resolves.toBe(0)
		expect(default_report()).toBe('')
	})

	it('writes to --output when given', async () => {
		const output = 'nested/out.txt'

		eslint_writes(two_file_report())

		await lint_rule.run_lint_rule([RULE, '--output', output], fixture.root)

		expect(readFileSync(path.join(fixture.root, output), 'utf8')).toContain(FIRST_VIOLATION)
	})
})

describe('lint_rule.run_lint_rule — a --paths report', () => {
	it("keeps a --paths run's cache and report apart from the whole run's", async () => {
		eslint_writes(two_file_report())

		await lint_rule.run_lint_rule([RULE, PATHS_FLAG, ...SUBSET], fixture.root)

		expect(mocked_run_eslint).toHaveBeenCalledWith(
			expect.objectContaining({ cache_file: LINT_RULE_PATHS_CACHE_FILE }),
		)
		expect(readFileSync(path.join(fixture.root, PATHS_REPORT), 'utf8')).toContain(FIRST_VIOLATION)
		expect(existsSync(path.join(fixture.root, DEFAULT_REPORT))).toBe(false)
		expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining(PATHS_REPORT))
	})
})

describe('lint_rule.run_lint_rule — no answer', () => {
	it('fails with the usage on unusable arguments, without running eslint', async () => {
		await expect(lint_rule.run_lint_rule([], fixture.root)).resolves.toBe(FAIL_EXIT_CODE)
		expect(mocked_run_eslint).not.toHaveBeenCalled()
		expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('usage'))
	})

	it.each([
		['no report', undefined, ESLINT_FATAL_EXIT_CODE],
		['an unreadable report', '{not json', ESLINT_FOUND_EXIT_CODE],
		['a report that is not a list', '{}', ESLINT_FOUND_EXIT_CODE],
		['a fatal exit beside a report', '[]', ESLINT_FATAL_EXIT_CODE],
	])('fails with the eslint output on %s', async (_case, report, exit_code) => {
		eslint_writes(report, exit_code)

		await expect(lint_rule.run_lint_rule([RULE], fixture.root)).resolves.toBe(FAIL_EXIT_CODE)
		expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining(ESLINT_OUTPUT))
	})

	it("never reads an earlier run's report as this one's", async () => {
		eslint_writes(two_file_report())
		await lint_rule.run_lint_rule([RULE], fixture.root)
		eslint_writes(undefined, ESLINT_FOUND_EXIT_CODE)

		await expect(lint_rule.run_lint_rule([RULE], fixture.root)).resolves.toBe(FAIL_EXIT_CODE)
	})
})
