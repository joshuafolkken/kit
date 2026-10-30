import path from 'node:path'

// One definition of "the process tools a lane reads are not installed".
//
// `ps` supplies caller ancestry and `pgrep` supplies lane liveness and reaping, so missing tools must
// be refused by name rather than interpreted as an absent process. Slim images may lack `procps`.

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
