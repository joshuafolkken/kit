import path from 'node:path'

const BINARY_NAME = 'osv-scanner'
const LOCKFILE_PATH = 'pnpm-lock.yaml'

// Where `josh audit:provision` puts a scanner it fetched itself, and the second place `josh audit`
// looks once PATH has come up empty (joshuafolkken/kit#1563). Under `node_modules` because that is
// the one directory every consumer of this package already ignores: a directory of our own would
// need a `.gitignore` entry distributed to every repository `josh sync` reaches, and a home-relative
// cache is refused outright by `no-global-shim-write.test.ts`. Losing the binary to `pnpm install`
// costs one re-fetch at the next session start, which is the cheap side of that trade.
const MANAGED_TOOL_SEGMENTS = ['node_modules', '.cache', 'josh-tools'] as const
const WINDOWS_PLATFORM = 'win32'
const WINDOWS_BINARY_SUFFIX = '.exe'

const INSTALL_INSTRUCTIONS = [
	'',
	'Install options:',
	'  Managed: pnpm josh audit:provision',
	'  macOS:  brew install osv-scanner',
	'  Go:     go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest',
	'  Docker: docker run --rm -v "$PWD:/src" ghcr.io/google/osv-scanner --lockfile=/src/pnpm-lock.yaml',
	'',
	'Docs: https://google.github.io/osv-scanner/',
].join('\n')

function build_scanner_arguments(lockfile_path: string): ReadonlyArray<string> {
	return [`--lockfile=${lockfile_path}`]
}

// The `.exe` suffix is not cosmetic on Windows: a file written without it is not executable there,
// so the provisioner and the audit would disagree about whether the scanner had been installed.
function build_managed_binary_path(project_root: string, platform: string): string {
	const suffix = platform === WINDOWS_PLATFORM ? WINDOWS_BINARY_SUFFIX : ''

	return path.join(project_root, ...MANAGED_TOOL_SEGMENTS, `${BINARY_NAME}${suffix}`)
}

function format_missing_binary_error(binary_name: string): string {
	return `${binary_name} is not installed.\n${INSTALL_INSTRUCTIONS}`
}

const security_audit_logic = {
	BINARY_NAME,
	LOCKFILE_PATH,
	build_managed_binary_path,
	build_scanner_arguments,
	format_missing_binary_error,
}

export { security_audit_logic }
