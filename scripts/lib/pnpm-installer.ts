import { verified_download } from './verified-download'

// Pin the installer bytes, independently of the pnpm version it installs.
// Source: pnpm/get.pnpm.io at 7c26e549143daf5cf072a38c428170ad8eccaf2d.
const VERSION = '12.6.0'
const URL =
	'https://raw.githubusercontent.com/pnpm/get.pnpm.io/7c26e549143daf5cf072a38c428170ad8eccaf2d/install.sh'
const SHA256 = '53d3ad6ef67d49d6951f3326bd3180e5c504c8f695bcdf73bb61ec7a4d4c9407'

function command(): string {
	return verified_download.command(URL, SHA256, `PNPM_VERSION=${VERSION} sh "$installer"`)
}

const pnpm_installer = { command }

export { pnpm_installer }
