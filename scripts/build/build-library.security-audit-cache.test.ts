import { existsSync, readFileSync } from 'node:fs'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeAll, describe, expect, it } from 'vitest'
import { build_library, library_paths } from './build-library'
import { library_consumer_fixture } from './library-consumer-fixture'

// A separate machine-wide security checker reuses `josh audit`'s pass cache through this export
// instead of a copy (joshuafolkken/kit#8255), so it has to resolve by package name — functions and
// types — and its surface must not drift silently: the lists below are exact.
const LIBRARY = 'security-audit-cache'
const { outfile: OUTFILE, dts_file: DTS_FILE } = library_paths(LIBRARY)
const BUILD_TIMEOUT = 60_000
const TYPE_CHECK_TIMEOUT = 30_000
const EXPORTED_NAMES = ['AuditPorts', 'security_audit_cache']
const CACHE_MEMBERS = ['PASS_LIFETIME_MS', 'pass_directory', 'reserved_audit', 'run']

const make_directory = temporary_directory('suite')

beforeAll(async () => {
	await build_library(LIBRARY)
}, BUILD_TIMEOUT)

describe('build_library security_audit_cache — compiled output', () => {
	it('writes dist/security-audit-cache/index.{js,d.ts} with no #scripts/* import left', () => {
		expect(existsSync(OUTFILE) && existsSync(DTS_FILE)).toBe(true)
		expect(readFileSync(OUTFILE, 'utf8')).not.toContain('#scripts/')
		expect(readFileSync(DTS_FILE, 'utf8')).not.toContain('#scripts/')
	})
})

describe('build_library security_audit_cache — imported by package name', () => {
	it('loads exactly the pass cache and its members under plain node', () => {
		const consumer = library_consumer_fixture.link_consumer(make_directory('cache-js-'))

		expect(library_consumer_fixture.runtime_surface(consumer, LIBRARY)).toStrictEqual({
			security_audit_cache: library_consumer_fixture.sorted_names(CACHE_MEMBERS),
		})
	})

	it(
		'type-checks AuditPorts and declares exactly the pinned names',
		() => {
			const consumer = library_consumer_fixture.link_consumer(make_directory('cache-dts-'))

			expect(
				library_consumer_fixture.declared_surface(consumer, LIBRARY, ['AuditPorts']),
			).toStrictEqual({ diagnostics: [], exports: EXPORTED_NAMES })
		},
		TYPE_CHECK_TIMEOUT,
	)
})
