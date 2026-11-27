import { existsSync, readFileSync } from 'node:fs'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeAll, describe, expect, it } from 'vitest'
import { build_library, library_paths } from './build-library'
import { library_consumer_fixture } from './library-consumer-fixture'

// A separate machine-wide security checker fetches the scanner through this export instead of a
// copy (joshuafolkken/kit#8255), so it has to resolve by package name — functions and types — and
// its surface must not drift silently: the lists below are exact, so an added or dropped name fails.
const LIBRARY = 'security-audit-provision'
const { outfile: OUTFILE, dts_file: DTS_FILE } = library_paths(LIBRARY)
const BUILD_TIMEOUT = 60_000
const TYPE_CHECK_TIMEOUT = 30_000
const EXPORTED_NAMES = ['ScannerAsset', 'security_audit_provision_logic']
const LOGIC_MEMBERS = [
	'MINIMUM_SCANNER_VERSION',
	'RETRY_INTERVAL_MS',
	'SCANNER_VERSION',
	'SESSION_DOWNLOAD_TIMEOUT_MS',
	'build_asset_name',
	'build_download_timeout',
	'build_download_url',
	'format_already_present',
	'format_below_floor',
	'format_checksum_mismatch',
	'format_download_failure',
	'format_installed',
	'format_provision_error',
	'format_recent_failure',
	'format_unsupported_platform',
	'meets_version_floor',
	'parse_scanner_version',
	'resolve_asset',
]

const make_directory = temporary_directory('suite')

beforeAll(async () => {
	await build_library(LIBRARY)
}, BUILD_TIMEOUT)

describe('build_library security_audit_provision — compiled output', () => {
	it('writes dist/security-audit-provision/index.{js,d.ts} with no #scripts/* import left', () => {
		expect(existsSync(OUTFILE) && existsSync(DTS_FILE)).toBe(true)
		expect(readFileSync(OUTFILE, 'utf8')).not.toContain('#scripts/')
		expect(readFileSync(DTS_FILE, 'utf8')).not.toContain('#scripts/')
	})
})

describe('build_library security_audit_provision — imported by package name', () => {
	it('loads exactly the provisioning logic and its members under plain node', () => {
		const consumer = library_consumer_fixture.link_consumer(make_directory('provision-js-'))

		expect(library_consumer_fixture.runtime_surface(consumer, LIBRARY)).toStrictEqual({
			security_audit_provision_logic: library_consumer_fixture.sorted_names(LOGIC_MEMBERS),
		})
	})

	it(
		'type-checks ScannerAsset and declares exactly the pinned names',
		() => {
			const consumer = library_consumer_fixture.link_consumer(make_directory('provision-dts-'))

			expect(
				library_consumer_fixture.declared_surface(consumer, LIBRARY, ['ScannerAsset']),
			).toStrictEqual({ diagnostics: [], exports: EXPORTED_NAMES })
		},
		TYPE_CHECK_TIMEOUT,
	)
})
