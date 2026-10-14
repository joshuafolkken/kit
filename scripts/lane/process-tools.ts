import path from 'node:path'

// One definition of "the process tools a lane reads are not installed".
//
// **`ps` and `pgrep` are a prerequisite, not an optional probe.** The owner check walks the caller's
// ancestry with `ps`, and lane liveness and reaping match children with `pgrep`. A machine without
// them (a slim Debian image ships no `procps`) used to read every probe as "nothing there": the
// ancestry stopped at the caller, `run:step` answered `unknown`, and the parent stopped before its
// first lane with no word of why. A missing tool is refused by name instead.

// What Node reports when the executable to spawn does not exist.
const NOT_FOUND_CODE = 'ENOENT'
const PACKAGE_HINT =
	'install the package that provides it (procps on Debian/Ubuntu: `apt-get install procps`)'

function is_not_found(error: unknown): boolean {
	return error instanceof Error && 'code' in error && error.code === NOT_FOUND_CODE
}

function missing_notice(command: string): string {
	return `\`${path.basename(command)}\` is not installed — kit's lane commands read processes with ps and pgrep; ${PACKAGE_HINT}`
}

/** Throw a named refusal when `error` says `command` could not be spawned because it does not exist. */
function throw_if_missing(command: string, error: unknown): void {
	if (is_not_found(error)) throw new Error(missing_notice(command), { cause: error })
}

const process_tools = { missing_notice, throw_if_missing }

export { process_tools }
