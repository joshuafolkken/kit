import { afterEach, describe, expect, it, vi } from 'vitest'
import { check_related, type CheckResult } from './check-related'
import { check_related_order } from './check-related-order'

const LINT_COMMAND = 'lint:related'
const TEST_COMMAND = 'test:related'
const TYPE_CHECK_COMMAND = 'check'
const COMMANDS = [LINT_COMMAND, TEST_COMMAND, TYPE_CHECK_COMMAND] as const

function result_of(command: string, exit_code = 0): CheckResult {
	return { command, exit_code, output: `${command} output` }
}

async function red_lint(command: string): Promise<CheckResult> {
	return result_of(command, command === LINT_COMMAND ? 1 : 0)
}

async function throwing(command: string): Promise<CheckResult> {
	if (command === LINT_COMMAND) throw new Error('spawn failed')

	return result_of(command)
}

// An executor whose checks stay pending until released, recording the order they started in.
function held_executor(): {
	execute: (command: string) => Promise<CheckResult>
	release: (command: string) => void
	started: Array<string>
} {
	const started: Array<string> = []
	const pending = new Map<string, () => void>()

	async function execute(command: string): Promise<CheckResult> {
		started.push(command)

		return await new Promise((resolve) => {
			pending.set(command, () => {
				resolve(result_of(command))
			})
		})
	}

	return { execute, release: (command) => pending.get(command)?.(), started }
}

afterEach(() => {
	vi.restoreAllMocks()
})

// joshuafolkken/kit#5784: the touched unit stage waits on lint:related as the full reach does.
describe('check_related_order.lint_first — test:related --touched', () => {
	it('never starts test:related --touched on a red lint:related', async () => {
		const touched = 'test:related --touched'
		const execute = vi.fn(red_lint)
		const ordered = check_related_order.lint_first(execute, [LINT_COMMAND, touched])
		const [, test] = await Promise.all([ordered(LINT_COMMAND), ordered(touched)])

		expect(test).toMatchObject({ command: touched, is_skipped: true })
		expect(execute).toHaveBeenCalledExactlyOnceWith(LINT_COMMAND)
	})
})

// joshuafolkken/kit#5387: a red lint:related still let a full-reach test:related run its minutes out.
describe('check_related_order.lint_first', () => {
	it('never starts test:related on a red lint:related and reports it not run', async () => {
		const execute = vi.fn(red_lint)
		const ordered = check_related_order.lint_first(execute, COMMANDS)
		const [lint, test] = await Promise.all([ordered(LINT_COMMAND), ordered(TEST_COMMAND)])

		expect(lint.exit_code).toBe(1)
		expect(test).toMatchObject({ command: TEST_COMMAND, is_skipped: true })
		expect(execute).not.toHaveBeenCalledWith(TEST_COMMAND)
		expect(execute).toHaveBeenCalledTimes(1)
	})

	it('runs test:related once lint:related is green', async () => {
		const execute = vi.fn(async (command: string) => result_of(command))
		const ordered = check_related_order.lint_first(execute, COMMANDS)

		await expect(ordered(TEST_COMMAND)).resolves.toStrictEqual(result_of(TEST_COMMAND))
		await expect(ordered(LINT_COMMAND)).resolves.toStrictEqual(result_of(LINT_COMMAND))
		expect(execute.mock.calls).toStrictEqual([[LINT_COMMAND], [TEST_COMMAND]])
	})

	it('reports test:related not run when lint:related throws', async () => {
		const ordered = check_related_order.lint_first(throwing, COMMANDS)

		await expect(ordered(TEST_COMMAND)).resolves.toMatchObject({ is_skipped: true })
	})

	it('starts test:related at once when lint:related is not among the checks (reused)', async () => {
		const execute = vi.fn(red_lint)
		const ordered = check_related_order.lint_first(execute, [TEST_COMMAND, TYPE_CHECK_COMMAND])

		expect(ordered).toBe(execute)
	})
})

describe('check_related.run_checks — lint:related first', () => {
	it('starts the others beside lint:related and test:related only after it is green', async () => {
		const { execute, release, started } = held_executor()
		const results = check_related.run_checks(execute, COMMANDS)

		await vi.waitFor(() => {
			expect(started).toStrictEqual([LINT_COMMAND, TYPE_CHECK_COMMAND])
		})
		release(LINT_COMMAND)
		await vi.waitFor(() => {
			expect(started).toContain(TEST_COMMAND)
		})
		release(TEST_COMMAND)
		release(TYPE_CHECK_COMMAND)

		expect(check_related.exit_code(await results)).toBe(0)
	})

	it('fails on lint:related alone with test:related named not run', async () => {
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
		const results = await check_related.run_checks(red_lint, COMMANDS)

		check_related.report_results(results)

		const report = write.mock.calls.map(([chunk]) => String(chunk)).join('')

		expect(check_related.exit_code(results)).toBe(1)
		expect(report).toContain(`=== ${TEST_COMMAND}: not run ===`)
		expect(report).toContain(`(not run: ${TEST_COMMAND})`)
		expect(report).toContain(`pnpm josh ${LINT_COMMAND}`)
		expect(report).not.toContain(`pnpm josh ${TEST_COMMAND}`)
	})
})
