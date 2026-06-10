import { existsSync } from 'node:fs'
import path from 'node:path'
import { execaSync } from 'execa'
import { doctor_logic } from './doctor-logic'

const JOSH_BIN = 'josh'

// Resolve the `josh` that the shell would run — the first match on PATH, via the platform's
// lookup command (`where` on Windows, `which` elsewhere). Undefined when the lookup fails or
// prints nothing (no `josh` on PATH, e.g. inside the kit repo where only `pnpm josh` runs).
function resolve_path_josh(): string | undefined {
	const lookup = doctor_logic.path_lookup_command(process.platform)
	const result = execaSync(lookup, [JOSH_BIN], { reject: false })

	return doctor_logic.first_path_line(result.stdout)
}

// Resolve the pnpm-global `josh` bin path. Undefined when pnpm is missing or the global bin does
// not contain a `josh` (kit not installed globally). `pnpm bin -g` prepends a `[WARN]` line to
// stdout inside a project, so the bin directory is extracted via first_path_line.
function resolve_pnpm_global_josh(): string | undefined {
	const result = execaSync('pnpm', ['bin', '-g'], { reject: false })
	const bin_directory = doctor_logic.first_path_line(result.stdout)
	if (bin_directory === undefined) return undefined
	const candidate = path.join(bin_directory, JOSH_BIN)

	return existsSync(candidate) ? candidate : undefined
}

const doctor_io = {
	resolve_path_josh,
	resolve_pnpm_global_josh,
}

export { doctor_io }
