// Pin the installer bytes, independently of the pnpm version it installs.
// Source: pnpm/get.pnpm.io at 7c26e549143daf5cf072a38c428170ad8eccaf2d.
const VERSION = '12.6.0'
const URL =
	'https://raw.githubusercontent.com/pnpm/get.pnpm.io/7c26e549143daf5cf072a38c428170ad8eccaf2d/install.sh'
const SHA256 = '53d3ad6ef67d49d6951f3326bd3180e5c504c8f695bcdf73bb61ec7a4d4c9407'

// Like the safe-chain setup: save, verify against the repository pin, then execute.
// The subshell scopes the cleanup trap; && also fails closed inside an npm fallback.
function command(): string {
	return [
		'(installer=$(mktemp) &&',
		`trap 'rm -f "$installer"' EXIT &&`,
		`curl --proto '=https' -fsSL ${URL} -o "$installer" &&`,
		`(echo "${SHA256}  $installer" |`,
		'(if command -v sha256sum >/dev/null 2>&1; then sha256sum -c -; else shasum -a 256 -c -; fi)) &&',
		`PNPM_VERSION=${VERSION} sh "$installer")`,
	].join(' ')
}

const pnpm_installer = { command }

export { pnpm_installer }
