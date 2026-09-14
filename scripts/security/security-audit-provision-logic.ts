import { security_audit_logic } from './security-audit-logic'

// Pinned, because an unpinned fetch is a binary nobody chose running against every lockfile in every
// consumer repository. The checksums below belong to this exact tag: bumping one without the other
// installs nothing at all, which is the failure that is visible rather than the one that is not.
const SCANNER_VERSION = '2.5.1'
const RELEASE_BASE_URL = 'https://github.com/google/osv-scanner/releases/download'

const WINDOWS_PLATFORM = 'win32'
const WINDOWS_ASSET_SUFFIX = '.exe'
const STAGING_SUFFIX = '.download'

// The asset is ~55 MB, and a link delivering it at 300 KB/s — measured, not hypothetical — takes
// over three minutes. A `SessionStart` hook is waited on, so a single bound generous enough to
// finish that download would be a three-minute stall at session start, and one short enough not to
// stall would abort every slow link for ever.
//
// So the bound depends on how the command was reached. The automatic attempt gives up quickly and
// says what to run; `--force` is a person typing a command in the foreground, where waiting for a
// large download is exactly what was asked for. Declared here rather than beside the `fetch` so the
// hook suite can derive the harness budget from the session bound: raising that without raising the
// declared timeout would have the harness kill the request at a moment the script did not choose.
const SESSION_DOWNLOAD_TIMEOUT_MS = 60_000
const FORCED_DOWNLOAD_TIMEOUT_MS = 600_000

function build_download_timeout(is_forced: boolean): number {
	return is_forced ? FORCED_DOWNLOAD_TIMEOUT_MS : SESSION_DOWNLOAD_TIMEOUT_MS
}

// How long a failed attempt suppresses the next one. Without it an offline machine — or one behind a
// proxy that blocks release assets — pays the whole download timeout again at every session start,
// and the `SessionStart` matcher is empty, so that is every startup, resume, clear and compact rather
// than once per machine. `--force` ignores the record, so a person who has just fixed their network
// never has to wait it out.
const MS_PER_HOUR = 3_600_000
const HOURS_BEFORE_RETRY = 6
const RETRY_INTERVAL_MS = HOURS_BEFORE_RETRY * MS_PER_HOUR

// node's names for the host on the left, the release's names on the right. A host missing from
// either map has no asset published for it, and the provisioner says so instead of guessing a URL.
const PLATFORM_NAMES: Readonly<Record<string, string>> = {
	darwin: 'darwin',
	linux: 'linux',
	win32: 'windows',
}

const ARCHITECTURE_NAMES: Readonly<Record<string, string>> = {
	arm64: 'arm64',
	x64: 'amd64',
}

// Transcribed from `osv-scanner_SHA256SUMS` of the tag above. Keyed by asset name so a wrong
// platform mapping cannot silently pick up a neighboring platform's checksum — which is why the keys
// are the release's own file names rather than anything this project's naming convention covers.
/* eslint-disable @typescript-eslint/naming-convention -- upstream release asset file names */
const ASSET_CHECKSUMS: Readonly<Record<string, string>> = {
	'osv-scanner_darwin_amd64': '9f89beb6c3d784893cb1cae0a3d56c529bfe91075418c2f9440c45b79654198b',
	'osv-scanner_darwin_arm64': '75c44d6332f892a1e56286f4105a98ed751ae28d215ca0a8b65cc00d84103054',
	'osv-scanner_linux_amd64': 'f9f25499a2c8cc367b3af45df2ea7eeca7fbccceab9c35079968f4b3652194be',
	'osv-scanner_linux_arm64': '3d0f5aa5a6baa8eb32bcef247388e149ef6030a6634ccae6fa0d62681fb27a6d',
	'osv-scanner_windows_amd64.exe':
		'25e42f5ef6711fd8c0fb45390972205891dd44c6bd02ac93f0f63e8e98d9bfb6',
	'osv-scanner_windows_arm64.exe':
		'33feb0b210a3e5ea7b338c719defc899f8833d990cdd297bcad4ff1a2586ec8b',
}
/* eslint-enable @typescript-eslint/naming-convention */

interface ScannerAsset {
	name: string
	url: string
	sha256: string
}

function build_asset_name(platform: string, architecture: string): string | undefined {
	const platform_name = PLATFORM_NAMES[platform]
	const architecture_name = ARCHITECTURE_NAMES[architecture]
	if (platform_name === undefined || architecture_name === undefined) return undefined

	const suffix = platform === WINDOWS_PLATFORM ? WINDOWS_ASSET_SUFFIX : ''

	return `${security_audit_logic.BINARY_NAME}_${platform_name}_${architecture_name}${suffix}`
}

function build_download_url(asset_name: string): string {
	return `${RELEASE_BASE_URL}/v${SCANNER_VERSION}/${asset_name}`
}

// The staging file the download is written to before it is renamed onto the target. The process id
// is what keeps two sessions of one project apart — the `SessionStart` matcher is empty, so a
// `clear` during a startup's download is exactly that — and without it their writes interleave into
// one file that both then rename into place, which the checksum cannot catch because each verified
// its own buffer.
function build_staging_path(target_path: string, process_id: number): string {
	return `${target_path}.${String(process_id)}${STAGING_SUFFIX}`
}

// The whole "where do we fetch from" decision in one pure call, so the table above is testable
// without a network round trip — which the unit suite forbids anyway (`test-network-guard.ts`).
function resolve_asset(platform: string, architecture: string): ScannerAsset | undefined {
	const name = build_asset_name(platform, architecture)
	if (name === undefined) return undefined

	const sha256 = ASSET_CHECKSUMS[name]
	if (sha256 === undefined) return undefined

	return { name, sha256, url: build_download_url(name) }
}

function format_already_present(location: string): string {
	return `osv-scanner is already available (${location}); nothing to provision.`
}

function format_unsupported_platform(platform: string, architecture: string): string {
	return `No pinned osv-scanner build for ${platform}/${architecture}; install it manually to run the pre-push audit.`
}

// The `--force` hint is on this message rather than only on the backoff one because the failure this
// most often reports is the session bound running out on a slow link, and the command that finishes
// that download is the one thing the reader needs.
function format_download_failure(url: string, reason: string): string {
	return `Could not fetch osv-scanner from ${url}: ${reason}. Run \`pnpm josh audit:provision --force\` to retry with a longer timeout; until then the pre-push audit will report the missing binary.`
}

// The mismatch is reported with both digests because the two things it can mean — a re-cut release
// asset and a tampered download — are told apart by comparing the actual digest with the tag's own
// published sums, and a message that hid it would leave nothing to compare.
function format_checksum_mismatch(asset_name: string, expected: string, actual: string): string {
	return `Checksum mismatch for ${asset_name}: expected ${expected}, got ${actual}. Nothing was installed.`
}

function format_installed(target_path: string): string {
	return `Installed osv-scanner v${SCANNER_VERSION} at ${target_path}.`
}

function format_recent_failure(): string {
	return `A previous attempt to provision osv-scanner failed less than ${String(HOURS_BEFORE_RETRY)} hours ago; not retrying at session start. Run \`pnpm josh audit:provision --force\` to try again now.`
}

// The catch-all, kept separate from `format_download_failure`: writing the binary can fail on its own
// terms — a read-only mount, a full disk, a directory the running user may not create — and pointing
// the reader at the network for a disk problem sends them to the wrong place entirely.
function format_provision_error(reason: string): string {
	return `Could not provision osv-scanner: ${reason}. The pre-push audit will report the missing binary.`
}

const security_audit_provision_logic = {
	FORCED_DOWNLOAD_TIMEOUT_MS,
	RETRY_INTERVAL_MS,
	SESSION_DOWNLOAD_TIMEOUT_MS,
	SCANNER_VERSION,
	build_asset_name,
	build_download_timeout,
	build_download_url,
	build_staging_path,
	format_already_present,
	format_checksum_mismatch,
	format_download_failure,
	format_installed,
	format_provision_error,
	format_recent_failure,
	format_unsupported_platform,
	resolve_asset,
}

export { security_audit_provision_logic }
export type { ScannerAsset }
