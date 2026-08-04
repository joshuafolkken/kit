import { describe, expect, it } from 'vitest'
import { lockfile_fixture } from './lockfile-fixture'
import { lockfile_overrides, type SpecifierMismatch } from './lockfile-overrides'

// kit #744: `pnpm update --latest` on an overridden dependency writes the raw package.json range
// into the importer instead of the override-applied one. `trustLockfile: true` hides the result
// locally, so this comparison is the only local signal before CI refuses the install.

const { make_lockfile, OVERRIDDEN_NAME, OVERRIDE_RANGE, RAW_MANIFEST_RANGE } = lockfile_fixture

const OVERRIDES = { [OVERRIDDEN_NAME]: OVERRIDE_RANGE }
const SELECTOR_KEY = `${OVERRIDDEN_NAME}@>=6`
const LINK_SPECIFIER = `link:../${OVERRIDDEN_NAME}`

const EXPECTED_MISMATCH: SpecifierMismatch = {
	importer: '.',
	name: OVERRIDDEN_NAME,
	lockfile_specifier: RAW_MANIFEST_RANGE,
	override: OVERRIDE_RANGE,
}

function find_mismatches(specifier: string, overrides = OVERRIDES): Array<SpecifierMismatch> {
	return lockfile_overrides.find_specifier_mismatches(make_lockfile(specifier), overrides)
}

describe('lockfile_overrides.find_specifier_mismatches — override honoured', () => {
	it('reports nothing when the importer specifier equals the override', () => {
		expect(find_mismatches(OVERRIDE_RANGE)).toEqual([])
	})

	it('reports nothing when there are no overrides at all', () => {
		expect(find_mismatches(RAW_MANIFEST_RANGE, {})).toEqual([])
	})

	it('reports nothing for an empty lockfile', () => {
		expect(lockfile_overrides.find_specifier_mismatches('', OVERRIDES)).toEqual([])
	})

	it('reports nothing for a package the overrides do not name', () => {
		expect(find_mismatches('^4.0.0', { devalue: '^5.8.1' })).toEqual([])
	})
})

describe('lockfile_overrides.find_specifier_mismatches — override lost', () => {
	it('reports the raw package.json range left in the importer', () => {
		expect(find_mismatches(RAW_MANIFEST_RANGE)).toEqual([EXPECTED_MISMATCH])
	})

	it.each(['dependencies', 'optionalDependencies'])('inspects the %s group too', (group) => {
		const lockfile = make_lockfile(RAW_MANIFEST_RANGE, group)

		expect(lockfile_overrides.find_specifier_mismatches(lockfile, OVERRIDES)).toEqual([
			EXPECTED_MISMATCH,
		])
	})

	it('names the importer that carries the mismatch', () => {
		const lockfile = make_lockfile(RAW_MANIFEST_RANGE).replace('  .:', '  packages/app:')
		const [mismatch] = lockfile_overrides.find_specifier_mismatches(lockfile, OVERRIDES)

		expect(mismatch?.importer).toBe('packages/app')
	})
})

describe('lockfile_overrides.find_specifier_mismatches — entries it cannot decide', () => {
	// A selector key rewrites only the dependents whose declared range matches it, which the
	// lockfile alone does not record — comparing it would manufacture false failures.
	it('ignores overrides whose key carries a version selector', () => {
		expect(find_mismatches(RAW_MANIFEST_RANGE, { [SELECTOR_KEY]: OVERRIDE_RANGE })).toEqual([])
	})

	it.each([`npm:${OVERRIDDEN_NAME}@${OVERRIDE_RANGE}`, LINK_SPECIFIER, `$${OVERRIDDEN_NAME}`])(
		'ignores the non-registry override value %j',
		(value) => {
			expect(find_mismatches(RAW_MANIFEST_RANGE, { [OVERRIDDEN_NAME]: value })).toEqual([])
		},
	)

	it.each(['workspace:*', LINK_SPECIFIER, 'catalog:default'])(
		'ignores the non-registry importer specifier %j',
		(specifier) => {
			expect(find_mismatches(specifier)).toEqual([])
		},
	)
})

// pnpm 11 writes pnpm-lock.yaml as a multi-document stream; reading only the first document would
// miss the dependency graph entirely and report a clean bill on any desync.
describe('lockfile_overrides.find_specifier_mismatches — multi-document lockfile', () => {
	const MULTI_DOCUMENT = [
		"lockfileVersion: '9.0'",
		'',
		'importers:',
		'',
		'  .:',
		'    packageManagerDependencies:',
		'      pnpm:',
		'        specifier: 11.18.0',
		'        version: 11.18.0',
		'',
		'---',
		make_lockfile(RAW_MANIFEST_RANGE),
	].join('\n')

	it('finds the mismatch recorded in the second document', () => {
		expect(lockfile_overrides.find_specifier_mismatches(MULTI_DOCUMENT, OVERRIDES)).toEqual([
			EXPECTED_MISMATCH,
		])
	})
})

describe('lockfile_overrides.format_mismatch_lines', () => {
	it('names the package, the importer, and both specifiers', () => {
		expect(lockfile_overrides.format_mismatch_lines([EXPECTED_MISMATCH])).toEqual([
			`  ${OVERRIDDEN_NAME} (importer .): lockfile ${RAW_MANIFEST_RANGE}, override ${OVERRIDE_RANGE}`,
		])
	})

	it('returns no lines for no mismatches', () => {
		expect(lockfile_overrides.format_mismatch_lines([])).toEqual([])
	})
})
