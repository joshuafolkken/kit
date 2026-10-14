// The two rules a `josh fresh:run` log follows: a run never reuses a name, and no token passed to
// the container reaches the file.

const LOG_EXTENSION = '.log'
const FIRST_RUN = 1

// What already carries a run's name: the logs of the directory this run writes to and, for a GitHub
// scenario, the account's repositories — another checkout, or a lane worktree since removed, numbers
// from its own logs and leaves repositories this directory has no log of.
interface TakenNames {
	logs: ReadonlyArray<string>
	repositories: ReadonlyArray<string>
}

function logged_names(logs: ReadonlyArray<string>): Array<string> {
	return logs
		.filter((file) => file.endsWith(LOG_EXTENSION))
		.map((file) => file.slice(0, -LOG_EXTENSION.length))
}

function run_number(scenario_name: string, run_name: string): number | undefined {
	const prefix = `${scenario_name}-`

	if (!run_name.startsWith(prefix)) return undefined

	const digits = run_name.slice(prefix.length)

	return /^\d+$/u.test(digits) ? Number(digits) : undefined
}

// The name is the project directory and, for a GitHub scenario, the repository `josh start` creates.
// It is numbered past every earlier log and repository, so a rerun leaves the last run's repository
// in place.
function next_name(scenario_name: string, taken_names: TakenNames): string {
	const taken = [...logged_names(taken_names.logs), ...taken_names.repositories]
		.map((run_name) => run_number(scenario_name, run_name))
		.filter((number) => number !== undefined)
	const next = taken.length === 0 ? FIRST_RUN : Math.max(...taken) + 1

	return `${scenario_name}-${String(next)}`
}

function file_name(run_name: string): string {
	return `${run_name}${LOG_EXTENSION}`
}

function redact(line: string, secrets: ReadonlyArray<string>): string {
	const present = secrets.filter((secret) => secret !== '')
	let redacted = line

	for (const secret of present) {
		redacted = redacted.replaceAll(secret, '[REDACTED]')
	}

	return redacted
}

const fresh_machine_log = { next_name, file_name, redact }

export { fresh_machine_log }
export type { TakenNames }
