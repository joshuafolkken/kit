import { describe, expect, it, vi } from 'vitest'
import { publishable_range } from './publishable-range'
import {
	MANIFEST_FIXTURE,
	probe_with_one_suppressed,
	RESOLVED_PROBE,
	SAFE_CHAIN_NOTICE,
	SUPPRESSED_NAME,
	SUPPRESSED_PROBE,
	SUPPRESSED_RANGE,
	WORKSPACE_NAME,
	WORKSPACE_RANGE,
} from './publishable-range-fixture'

// The shape under test is the one that broke consumers (#742): a floor pinned to a release the
// supply-chain guard still hides. The fixtures reproduce what `pnpm view <name>@<range> version`
// actually writes — including safe-chain's notice on stdout — rather than a synthetic boolean, so
// the parsing is exercised against real output rather than a tidied-up version of it.

const RANGE_COUNT = 19

describe('read_published_ranges', () => {
	it('collects the dependencies a consumer installs', () => {
		expect(publishable_range.read_published_ranges(MANIFEST_FIXTURE)).toEqual([
			{ name: 'semver', range: '^7.8.5' },
			{ name: SUPPRESSED_NAME, range: SUPPRESSED_RANGE },
			{ name: WORKSPACE_NAME, range: WORKSPACE_RANGE },
		])
	})

	it('leaves devDependencies out — a consumer never installs them', () => {
		const names = publishable_range
			.read_published_ranges(MANIFEST_FIXTURE)
			.map((entry) => entry.name)

		expect(names).not.toContain('vitest')
	})

	it('reports no ranges when the manifest declares no dependencies', () => {
		expect(publishable_range.read_published_ranges('{}')).toEqual([])
	})
})

describe('partition_registry_ranges', () => {
	const ranges = publishable_range.read_published_ranges(MANIFEST_FIXTURE)

	it('keeps the ranges the registry can answer for', () => {
		const names = publishable_range.partition_registry_ranges(ranges).checked.map((e) => e.name)

		expect(names).toEqual(['semver', SUPPRESSED_NAME])
	})

	// Probing a workspace link would report a violation for a dependency that installs fine, and
	// this guard runs in consumer repos where those protocols are ordinary.
	it('sets aside a workspace protocol the registry cannot resolve', () => {
		expect(publishable_range.partition_registry_ranges(ranges).skipped).toEqual([
			{ name: WORKSPACE_NAME, range: WORKSPACE_RANGE },
		])
	})
})

describe('is_registry_range', () => {
	it('accepts a caret range', () => {
		expect(publishable_range.is_registry_range('^4.23.4')).toBe(true)
	})

	it.each(['workspace:*', 'catalog:default', 'file:../local', 'link:../local'])(
		'rejects the non-registry protocol %s',
		(range) => {
			expect(publishable_range.is_registry_range(range)).toBe(false)
		},
	)
})

describe('format_skipped', () => {
	it('names what was left unchecked so narrowed coverage is visible', () => {
		expect(
			publishable_range.format_skipped([{ name: WORKSPACE_NAME, range: WORKSPACE_RANGE }]),
		).toContain(`${WORKSPACE_NAME}@${WORKSPACE_RANGE}`)
	})
})

describe('is_satisfiable', () => {
	it('accepts a probe that printed a version', () => {
		expect(publishable_range.is_satisfiable(RESOLVED_PROBE)).toBe(true)
	})

	it('rejects a probe that exited non-zero with no output', () => {
		expect(publishable_range.is_satisfiable(SUPPRESSED_PROBE)).toBe(false)
	})

	it('rejects a zero exit with blank output so an empty answer is never read as success', () => {
		expect(publishable_range.is_satisfiable({ exit_code: 0, stdout: '  \n' })).toBe(false)
	})

	// safe-chain writes its banner to stdout, so "output exists" is not evidence a version was
	// returned — the guard would pass every range on a machine where the shim is active.
	it('rejects a zero exit carrying only the safe-chain notice', () => {
		expect(publishable_range.is_satisfiable({ exit_code: 0, stdout: SAFE_CHAIN_NOTICE })).toBe(
			false,
		)
	})

	it('accepts a version printed alongside the safe-chain notice', () => {
		const stdout = `4.23.4\n${SAFE_CHAIN_NOTICE}`

		expect(publishable_range.is_satisfiable({ exit_code: 0, stdout })).toBe(true)
	})

	it('rejects a range echoed back without a concrete version', () => {
		expect(publishable_range.is_satisfiable({ exit_code: 0, stdout: '^4.23.5\n' })).toBe(false)
	})

	it('fails closed when the probe could not reach the registry', () => {
		expect(publishable_range.is_satisfiable({ exit_code: 1, stdout: 'network error' })).toBe(false)
	})
})

describe('find_unsatisfiable', () => {
	it('names only the range with no visible version', () => {
		const ranges = publishable_range.read_published_ranges(MANIFEST_FIXTURE)

		expect(publishable_range.find_unsatisfiable(ranges, probe_with_one_suppressed)).toEqual([
			{ name: SUPPRESSED_NAME, range: SUPPRESSED_RANGE },
		])
	})

	it('returns nothing when every range resolves', () => {
		const ranges = publishable_range.read_published_ranges(MANIFEST_FIXTURE)

		expect(publishable_range.find_unsatisfiable(ranges, () => RESOLVED_PROBE)).toEqual([])
	})

	it('probes each dependency with its own declared range', () => {
		const probe = vi.fn(() => RESOLVED_PROBE)

		publishable_range.find_unsatisfiable(
			publishable_range.read_published_ranges(MANIFEST_FIXTURE),
			probe,
		)

		expect(probe).toHaveBeenCalledWith(SUPPRESSED_NAME, SUPPRESSED_RANGE)
	})
})

describe('format_failure', () => {
	const violations = [{ name: SUPPRESSED_NAME, range: SUPPRESSED_RANGE }]

	it('names the offending package and range', () => {
		expect(publishable_range.format_failure(violations)).toContain(
			`${SUPPRESSED_NAME}@${SUPPRESSED_RANGE}`,
		)
	})

	it('tells the reader to lower the floor rather than raise it', () => {
		expect(publishable_range.format_failure(violations)).toContain('Lower each floor')
	})
})

describe('format_success', () => {
	it('reports how many ranges were checked', () => {
		expect(publishable_range.format_success(RANGE_COUNT)).toContain(String(RANGE_COUNT))
	})
})
