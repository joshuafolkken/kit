const BINARY_NAME = 'osv-scanner'
const LOCKFILE_PATH = 'pnpm-lock.yaml'

const INSTALL_INSTRUCTIONS = [
	'',
	'Install options:',
	'  macOS:  brew install osv-scanner',
	'  Go:     go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest',
	'  Docker: docker run --rm -v "$PWD:/src" ghcr.io/google/osv-scanner --lockfile=/src/pnpm-lock.yaml',
	'',
	'Docs: https://google.github.io/osv-scanner/',
].join('\n')

function build_scanner_arguments(lockfile_path: string): ReadonlyArray<string> {
	return [`--lockfile=${lockfile_path}`]
}

function format_missing_binary_error(binary_name: string): string {
	return `${binary_name} is not installed.\n${INSTALL_INSTRUCTIONS}`
}

const security_audit_logic = {
	BINARY_NAME,
	LOCKFILE_PATH,
	build_scanner_arguments,
	format_missing_binary_error,
}

export { security_audit_logic }
