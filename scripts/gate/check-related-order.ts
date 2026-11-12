import type { CheckResult } from './check-related-section'

// **`test:related` starts only once `lint:related` is green** (joshuafolkken/kit#5387): a lint failure,
// a document over its budget found in seconds, still let a full-reach `test:related` run its minutes
// out, and the fix paid that reach again. The other checks still start beside `lint:related`; a run
// whose `lint:related` is reused starts `test:related` at once. A `test:related --touched` waits the same.

const LINT_RELATED = 'lint:related'
const TEST_RELATED = 'test:related'

type CheckExecutor = (command: string) => Promise<CheckResult>

function is_test_related(command: string): boolean {
	return command.split(' ', 1)[0] === TEST_RELATED
}

function skipped_result(command: string): CheckResult {
	return {
		command,
		exit_code: 1,
		output: `${command} was not run: ${LINT_RELATED} failed`,
		is_skipped: true,
	}
}

async function is_lint_green(lint: Promise<CheckResult>): Promise<boolean> {
	try {
		const result = await lint

		return result.exit_code === 0
	} catch {
		return false
	}
}

// An executor that runs `lint:related` once, at whichever call asks first, and holds `test:related`
// behind its verdict.
function lint_first(execute: CheckExecutor, commands: ReadonlyArray<string>): CheckExecutor {
	const has_test = commands.some((command) => is_test_related(command))

	if (!has_test || !commands.includes(LINT_RELATED)) return execute

	const runs = new Map<string, Promise<CheckResult>>()

	async function lint_run(): Promise<CheckResult> {
		const run = runs.get(LINT_RELATED) ?? execute(LINT_RELATED)

		runs.set(LINT_RELATED, run)

		return await run
	}

	async function ordered(command: string): Promise<CheckResult> {
		if (command === LINT_RELATED) return await lint_run()
		if (!is_test_related(command)) return await execute(command)

		return (await is_lint_green(lint_run())) ? await execute(command) : skipped_result(command)
	}

	return ordered
}

const check_related_order = { lint_first }

export { check_related_order }
