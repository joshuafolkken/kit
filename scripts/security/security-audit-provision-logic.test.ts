import { describe, expect, it } from 'vitest'
import { security_audit_provision_logic } from './security-audit-provision-logic'

const {
	SCANNER_VERSION,
	build_asset_name,
	build_download_timeout,
	build_download_url,
	build_staging_path,
	format_already_present,
	format_checksum_mismatch,
	format_download_failure,
	format_installed,
	format_unsupported_platform,
	resolve_asset,
} = security_audit_provision_logic

const SHA256_HEX_LENGTH = 64
const SAMPLE_URL = 'https://example.test/asset'
const LINUX_AMD64_ASSET = 'osv-scanner_linux_amd64'
const DARWIN_ARM64_ASSET = 'osv-scanner_darwin_arm64'
const STAGING_TARGET = '/tool/osv-scanner'
const SESSION_BOUND_CEILING_MS = 90_000

describe('security_audit_provision_logic.build_asset_name', () => {
	it('maps node platform and architecture names onto the release asset names', () => {
		expect(build_asset_name('darwin', 'arm64')).toBe(DARWIN_ARM64_ASSET)
		expect(build_asset_name('linux', 'x64')).toBe(LINUX_AMD64_ASSET)
	})

	it('adds the .exe suffix the Windows assets carry', () => {
		expect(build_asset_name('win32', 'x64')).toBe('osv-scanner_windows_amd64.exe')
	})

	it('returns undefined for a platform the release publishes nothing for', () => {
		expect(build_asset_name('freebsd', 'x64')).toBeUndefined()
	})

	it('returns undefined for an architecture the release publishes nothing for', () => {
		expect(build_asset_name('linux', 'ia32')).toBeUndefined()
	})
})

describe('security_audit_provision_logic.build_download_url', () => {
	it('pins the URL to the tagged release rather than a moving latest', () => {
		expect(build_download_url(LINUX_AMD64_ASSET)).toBe(
			`https://github.com/google/osv-scanner/releases/download/v${SCANNER_VERSION}/${LINUX_AMD64_ASSET}`,
		)
	})
})

// Measured: the asset is ~55 MB and a 300 KB/s link needs over three minutes for it. A SessionStart
// hook is waited on, so the automatic attempt gives up long before that and says what to run, while
// `--force` is someone asking for the download and willing to wait for it.
describe('security_audit_provision_logic.build_download_timeout', () => {
	it('gives an explicitly forced run far longer than the one at session start', () => {
		expect(build_download_timeout(true)).toBeGreaterThan(build_download_timeout(false))
	})

	it('keeps the session-start bound short enough not to stall a session start', () => {
		expect(build_download_timeout(false)).toBeLessThanOrEqual(SESSION_BOUND_CEILING_MS)
	})
})

describe('security_audit_provision_logic.build_staging_path', () => {
	const first_pid = 4321
	const second_pid = 8765

	it('names the staging file after the target and the process that is writing it', () => {
		expect(build_staging_path(STAGING_TARGET, first_pid)).toBe(
			`${STAGING_TARGET}.${String(first_pid)}.download`,
		)
	})

	// The whole point of carrying the id: two sessions of one project download at once, and a shared
	// staging name would let their writes interleave into the file both then rename into place.
	it('gives two processes two different staging files', () => {
		expect(build_staging_path(STAGING_TARGET, first_pid)).not.toBe(
			build_staging_path(STAGING_TARGET, second_pid),
		)
	})
})

describe('security_audit_provision_logic.resolve_asset', () => {
	it('returns the name, the pinned URL and the checksum together', () => {
		const asset = resolve_asset('darwin', 'arm64')

		expect(asset?.name).toBe(DARWIN_ARM64_ASSET)
		expect(asset?.url).toContain(`/v${SCANNER_VERSION}/${DARWIN_ARM64_ASSET}`)
		expect(asset?.sha256).toBe('75c44d6332f892a1e56286f4105a98ed751ae28d215ca0a8b65cc00d84103054')
	})

	// A checksum table that had drifted out of step with the platform table would hand back a URL
	// with no digest to check it against, which is the one outcome worse than not provisioning.
	it('publishes a full sha256 digest for every platform it names an asset for', () => {
		const hosts = [
			['darwin', 'arm64'],
			['darwin', 'x64'],
			['linux', 'arm64'],
			['linux', 'x64'],
			['win32', 'arm64'],
			['win32', 'x64'],
		] as const

		for (const [platform, architecture] of hosts) {
			expect(resolve_asset(platform, architecture)?.sha256).toMatch(
				new RegExp(`^[0-9a-f]{${String(SHA256_HEX_LENGTH)}}$`, 'u'),
			)
		}
	})

	it('returns undefined rather than guessing a URL for an unpublished host', () => {
		expect(resolve_asset('freebsd', 'x64')).toBeUndefined()
	})
})

describe('security_audit_provision_logic messages', () => {
	it('names where an already-available scanner was found', () => {
		expect(format_already_present('on PATH')).toContain('on PATH')
	})

	it('tells an unsupported host to install the scanner itself', () => {
		const message = format_unsupported_platform('freebsd', 'x64')

		expect(message).toContain('freebsd/x64')
		expect(message).toContain('install it manually')
	})

	it('says the audit will still report the missing binary when the fetch fails', () => {
		const message = format_download_failure(SAMPLE_URL, 'timed out')

		expect(message).toContain(SAMPLE_URL)
		expect(message).toContain('timed out')
		expect(message).toContain('pre-push audit')
	})

	it('carries both digests and states that nothing was installed', () => {
		const message = format_checksum_mismatch(LINUX_AMD64_ASSET, 'aaa', 'bbb')

		expect(message).toContain('expected aaa')
		expect(message).toContain('got bbb')
		expect(message).toContain('Nothing was installed')
	})

	it('names the pinned version it installed', () => {
		expect(format_installed('/repo/tool/osv-scanner')).toContain(`v${SCANNER_VERSION}`)
	})
})
