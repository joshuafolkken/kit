import type { CheckResult } from './check-related-section'

// **`test:related` starts only once every other check is green** (joshuafolkken/kit#5387,
// joshuafolkken/kit#7786): a lint failure, a document over its budget or a type error, each found in
// seconds, still let a full-reach `test:related` run its minutes out, and the fix paid that reach
// again. The other checks are the cheap ones — the type check's median is 8.1 s against the minutes
// `test:related` takes — so a green run pays that much more. All readers also wait for lint's writers; a run whose
// `lint:related` is reused starts them at once. A `test:related --touched` waits the same.

const LINT_RELATED = 'lint:related'
const TEST_RELATED = 'test:related'

type CheckExecutor = (command: string) => Promise<CheckResult>

function is_test_related(command: string): boolean {
	return command.split(' ', 1)[0] === TEST_RELATED
}

function skipped_result(command: string, red: ReadonlyArray<string>): CheckResult {
	return {
		command,
		exit_code: 1,
		output: `${command} was not run: ${red.join(', ')} failed`,
		is_skipped: true,
	}
}

async function is_green(run: Promise<CheckResult>): Promise<boolean> {
	try {
		const result = await run

		return result.exit_code === 0
	} catch {
		return false
	}
}

async function red_of(
	cheap: ReadonlyArray<string>,
	run_once: CheckExecutor,
): Promise<ReadonlyArray<string>> {
	const greens = await Promise.all(cheap.map(async (command) => await is_green(run_once(command))))

	return cheap.filter((_command, index) => greens[index] !== true)
}

async function once(
	runs: Map<string, Promise<CheckResult>>,
	command: string,
	start: () => Promise<CheckResult>,
): Promise<CheckResult> {
	const run = runs.get(command) ?? start()

	runs.set(command, run)

	return await run
}

// An executor that runs each cheap check once, at whichever call asks first — `lint:related` before
// the other readers — and holds `test:related` behind all of their verdicts.
function checks_first(execute: CheckExecutor, commands: ReadonlyArray<string>): CheckExecutor {
	const cheap = commands.filter((command) => !is_test_related(command))

	if (cheap.length === 0) return execute

	const runs = new Map<string, Promise<CheckResult>>()

	async function lint_run(): Promise<CheckResult> {
		return await once(runs, LINT_RELATED, async () => await execute(LINT_RELATED))
	}

	async function start(command: string): Promise<CheckResult> {
		if (command !== LINT_RELATED && cheap.includes(LINT_RELATED)) await is_green(lint_run())

		return await execute(command)
	}

	async function run_once(command: string): Promise<CheckResult> {
		return await once(runs, command, async () => await start(command))
	}

	async function ordered(command: string): Promise<CheckResult> {
		if (!is_test_related(command)) return await run_once(command)
		const red = await red_of(cheap, run_once)

		return red.length === 0 ? await execute(command) : skipped_result(command, red)
	}

	return ordered
}

const check_related_order = { checks_first }

export { check_related_order }
