import { execa } from 'execa'
import { describe, expect, it, vi } from 'vitest'
import { check_related, type CheckResult } from './check-related'

const execa_mock = vi.hoisted(() => vi.fn())

vi.mock('execa', () => ({ execa: execa_mock }))

const CHECK_COMMANDS = ['lint:related', 'test:related', 'check', 'cspell:dot'] as const
const [LINT_COMMAND] = CHECK_COMMANDS
const [, TEST_COMMAND, TYPE_CHECK_COMMAND] = CHECK_COMMANDS
const TEST_FAILURE = 'test failed'
const TYPE_ERROR_OUTPUT =
	"src/a.ts(1,7): error TS2322: Type 'number' is not assignable to type 'string'."
const TYPE_CHECK_EXIT_CODE = 2
const LINT_OUTPUT = 'lint output'
const EXECA_OUTPUT = 'version output'

async function rejecting_check(command: string): Promise<CheckResult> {
	if (command === TEST_COMMAND) throw new Error(TEST_FAILURE)

	return { command, exit_code: 0, output: `${command} output` }
}

async function passing_check(command: string): Promise<CheckResult> {
	return { command, exit_code: 0, output: '' }
}

async function type_error_check(command: string): Promise<CheckResult> {
	if (command === TYPE_CHECK_COMMAND) {
		return { command, exit_code: TYPE_CHECK_EXIT_CODE, output: TYPE_ERROR_OUTPUT }
	}

	return { command, exit_code: 0, output: '' }
}

describe('check_related.run_checks', () => {
	it('starts every check before awaiting any result', async () => {
		const started: Array<string> = []
		const pending = new Map<string, (result: CheckResult) => void>()

		async function execute(command: string): Promise<CheckResult> {
			started.push(command)

			return await new Promise((resolve) => {
				pending.set(command, resolve)
			})
		}

		const results = check_related.run_checks(execute)

		await vi.waitFor(() => {
			expect(started).toEqual(CHECK_COMMANDS)
		})

		for (const command of CHECK_COMMANDS) {
			const complete = pending.get(command)
			if (complete === undefined) throw new Error(`Missing pending result for ${command}`)
			complete({ command, exit_code: 0, output: `${command} output` })
		}

		await expect(results).resolves.toMatchObject(
			CHECK_COMMANDS.map((command) => ({ command, exit_code: 0 })),
		)
	})

	it('waits for every result and fails when one check rejects', async () => {
		const results = await check_related.run_checks(rejecting_check)

		expect(results.map((result) => result.command)).toEqual(CHECK_COMMANDS)
		expect(results.find((result) => result.command === TEST_COMMAND)).toMatchObject({
			exit_code: 1,
			output: TEST_FAILURE,
		})
		expect(check_related.exit_code(results)).toBe(1)
	})
})

describe('check_related type check', () => {
	it('runs the type check and fails with its output when the tree has a type error', async () => {
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
		const results = await check_related.run_checks(type_error_check)

		check_related.report_results(results)

		const report = write.mock.calls.map(([chunk]) => String(chunk)).join('')

		expect(check_related.exit_code(results)).toBe(1)
		expect(report).toContain(
			`=== ${TYPE_CHECK_COMMAND}: failed (${String(TYPE_CHECK_EXIT_CODE)}) ===`,
		)
		expect(report).toContain(TYPE_ERROR_OUTPUT)
	})

	it('passes with the type check reported green when the tree has no type error', async () => {
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
		const results = await check_related.run_checks(passing_check)

		check_related.report_results(results)

		const report = write.mock.calls.map(([chunk]) => String(chunk)).join('')

		expect(check_related.exit_code(results)).toBe(0)
		expect(report).toContain(`=== ${TYPE_CHECK_COMMAND}: passed ===`)
	})
})

describe('check_related.execute_check', () => {
	it('runs josh through execa when no test runner is provided', async () => {
		execa_mock.mockResolvedValue({ all: EXECA_OUTPUT, exitCode: 0 })
		const result = await check_related.execute_check('version')

		expect(execa).toHaveBeenCalledWith('pnpm', ['josh', 'version'], { all: true, reject: false })
		expect(result.exit_code).toBe(0)
		expect(result.output).toBe(EXECA_OUTPUT)
	})

	it('runs the registered josh command and returns its exit code and combined output', async () => {
		const invocations: Array<{ args: Array<string>; file: string }> = []
		const result = await check_related.execute_check(LINT_COMMAND, async (file, args) => {
			invocations.push({ args, file })

			return { all: LINT_OUTPUT, exitCode: 2 }
		})

		expect(invocations).toStrictEqual([{ file: 'pnpm', args: ['josh', LINT_COMMAND] }])
		expect(result).toStrictEqual({ command: LINT_COMMAND, exit_code: 2, output: LINT_OUTPUT })
	})
})

describe('check_related.report_results', () => {
	it('prints every command and its output in one report', () => {
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
		const results = CHECK_COMMANDS.map((command): CheckResult => ({
			command,
			exit_code: 0,
			output: `${command} output`,
		}))

		check_related.report_results(results)

		const report = write.mock.calls.map(([chunk]) => String(chunk)).join('')

		for (const command of CHECK_COMMANDS) {
			expect(report).toContain(`=== ${command}: passed ===`)
			expect(report).toContain(`${command} output`)
		}
	})
})
