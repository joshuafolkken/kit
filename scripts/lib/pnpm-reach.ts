// One definition of "pnpm is not reachable from this process", for every caller that starts pnpm.
//
// `josh` runs its checks as `pnpm josh <check>` children, so a `pnpm` missing from the PATH this
// process sees fails every one of them before it starts. Nothing in the child's output can say so —
// there is no child — and the two places that can tell the user (the spawn itself and `josh doctor`)
// have to say the same thing.

const PNPM = 'pnpm'
// What Node reports when the executable to spawn is not on PATH.
const NOT_FOUND_CODE = 'ENOENT'
const PREREQUISITES_URL =
	'https://github.com/joshuafolkken/kit/blob/main/docs/setup/prerequisites.md#2-install-pnpm-and-nodejs'
const NOT_ON_PATH_NOTICE = [
	'pnpm was not found on the PATH this process sees, so the command could not start.',
	'A shell opened by an editor, an agent or a service can have a different PATH from your terminal.',
	`Install pnpm or add its directory to that PATH: ${PREREQUISITES_URL}`,
].join('\n')

// Narrowed to the one field it reads: execa's declared result type does not carry `code` on the
// non-rejecting path, though the value is there at runtime whenever the spawn itself failed.
function is_not_found(result: { code?: string | undefined }): boolean {
	return result.code === NOT_FOUND_CODE
}

const pnpm_reach = { PNPM, NOT_ON_PATH_NOTICE, is_not_found }

export { pnpm_reach }
