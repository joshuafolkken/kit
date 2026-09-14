import { describe, expect, it } from 'vitest'
import { fix_gh_packages_logic } from './fix-gh-packages-logic'

const GH_SCOPE = '@joshuafolkken'
const PKG_KEY = '@joshuafolkken/kit@0.142.0'
const UNSCOPED_PKG_KEY = 'react@18.0.0'
const OTHER_PKG_KEY = '@joshuafolkken/other@1.0.0'
const TARBALL_URL = 'https://npm.pkg.github.com/download/@joshuafolkken/kit/0.142.0/abc123deadbeef'
const INTEGRITY = 'sha512-abcdef1234567890'

const LOCKFILE_WITH_ENTRY = `lockfileVersion: '9.0'\n\npackages:\n\n  '${PKG_KEY}':\n    resolution:\n      integrity: ${INTEGRITY}\n\nsnapshots:\n`

describe('fix_gh_packages_logic.parse_gh_scopes', () => {
	it('returns scope mapped to npm.pkg.github.com', () => {
		const result = fix_gh_packages_logic.parse_gh_scopes(
			'@joshuafolkken:registry=https://npm.pkg.github.com\n',
		)

		expect(result.has(GH_SCOPE)).toBe(true)
	})

	it('ignores scopes mapped to other registries', () => {
		const result = fix_gh_packages_logic.parse_gh_scopes(
			'@other:registry=https://registry.npmjs.org\n',
		)

		expect(result.size).toBe(0)
	})

	it('returns multiple scopes when multiple GitHub Packages registries present', () => {
		const npmrc =
			'@joshuafolkken:registry=https://npm.pkg.github.com\n@another:registry=https://npm.pkg.github.com\n'
		const result = fix_gh_packages_logic.parse_gh_scopes(npmrc)

		expect(result.size).toBe(2)
		expect(result.has(GH_SCOPE)).toBe(true)
		expect(result.has('@another')).toBe(true)
	})

	it('returns empty set for empty npmrc', () => {
		expect(fix_gh_packages_logic.parse_gh_scopes('').size).toBe(0)
	})

	it('matches registry entry with trailing slash', () => {
		const result = fix_gh_packages_logic.parse_gh_scopes(
			'@joshuafolkken:registry=https://npm.pkg.github.com/\n',
		)

		expect(result.has(GH_SCOPE)).toBe(true)
	})
})

describe('fix_gh_packages_logic.parse_npmrc_auth_token', () => {
	it('returns token when a real token is present', () => {
		const npmrc = '//npm.pkg.github.com/:_authToken=abc123\n'

		expect(fix_gh_packages_logic.parse_npmrc_auth_token(npmrc)).toBe('abc123')
	})

	it('returns undefined for template variable token', () => {
		const npmrc = '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n'

		expect(fix_gh_packages_logic.parse_npmrc_auth_token(npmrc)).toBeUndefined()
	})

	it('returns undefined when no auth line is present', () => {
		expect(fix_gh_packages_logic.parse_npmrc_auth_token('')).toBeUndefined()
	})

	it('returns undefined for empty token value', () => {
		const npmrc = '//npm.pkg.github.com/:_authToken=\n'

		expect(fix_gh_packages_logic.parse_npmrc_auth_token(npmrc)).toBeUndefined()
	})
})

const SELF_MANAGEMENT_PKG_KEY = '@pnpm/exe@11.1.3'
const PNPM_11_MULTI_DOC_LOCKFILE =
	`lockfileVersion: '9.0'\n\n` +
	`importers:\n  .:\n    packageManagerDependencies:\n      '@pnpm/exe':\n        specifier: 11.1.3\n\n` +
	`packages:\n\n  '${SELF_MANAGEMENT_PKG_KEY}':\n    resolution:\n      integrity: sha512-self-management\n\nsnapshots: {}\n` +
	`---\n` +
	`lockfileVersion: '9.0'\n\n` +
	`settings:\n  autoInstallPeers: true\n\n` +
	`importers:\n  .:\n    devDependencies:\n      '@joshuafolkken/kit':\n        specifier: 0.208.0\n\n` +
	`packages:\n\n  '${PKG_KEY}':\n    resolution:\n      integrity: ${INTEGRITY}\n\nsnapshots: {}\n`

describe('fix_gh_packages_logic.parse_lockfile_packages', () => {
	it('parses a single-document lockfile', () => {
		const result = fix_gh_packages_logic.parse_lockfile_packages(LOCKFILE_WITH_ENTRY)

		expect(Object.keys(result)).toContain(PKG_KEY)
	})

	it('parses a pnpm 11 multi-document lockfile without throwing', () => {
		expect(() =>
			fix_gh_packages_logic.parse_lockfile_packages(PNPM_11_MULTI_DOC_LOCKFILE),
		).not.toThrow()
	})

	it('merges packages from every document in a multi-document lockfile', () => {
		const result = fix_gh_packages_logic.parse_lockfile_packages(PNPM_11_MULTI_DOC_LOCKFILE)

		expect(Object.keys(result)).toContain(PKG_KEY)
		expect(Object.keys(result)).toContain(SELF_MANAGEMENT_PKG_KEY)
	})

	it('returns an empty object when no document declares packages', () => {
		expect(fix_gh_packages_logic.parse_lockfile_packages("lockfileVersion: '9.0'\n")).toEqual({})
	})
})

describe('fix_gh_packages_logic.needs_tarball_fix', () => {
	const scopes = new Set([GH_SCOPE])

	it('returns true for gh packages entry without tarball', () => {
		const entry = { resolution: { integrity: INTEGRITY } }

		expect(fix_gh_packages_logic.needs_tarball_fix(PKG_KEY, entry, scopes)).toBe(true)
	})

	it('returns false when tarball already present', () => {
		const entry = { resolution: { integrity: INTEGRITY, tarball: TARBALL_URL } }

		expect(fix_gh_packages_logic.needs_tarball_fix(PKG_KEY, entry, scopes)).toBe(false)
	})

	it('returns false for non-scoped package', () => {
		const entry = { resolution: { integrity: INTEGRITY } }

		expect(fix_gh_packages_logic.needs_tarball_fix(UNSCOPED_PKG_KEY, entry, scopes)).toBe(false)
	})

	it('returns false for different scope not in gh packages', () => {
		const entry = { resolution: { integrity: INTEGRITY } }

		expect(fix_gh_packages_logic.needs_tarball_fix('@other/pkg@1.0.0', entry, scopes)).toBe(false)
	})

	it('returns true for gh packages entry with no resolution', () => {
		expect(fix_gh_packages_logic.needs_tarball_fix(PKG_KEY, {}, scopes)).toBe(true)
	})
})

describe('fix_gh_packages_logic.package_path_from_key', () => {
	it('extracts @scope/name from scoped package key', () => {
		expect(fix_gh_packages_logic.package_path_from_key(PKG_KEY)).toBe('@joshuafolkken/kit')
	})

	it('extracts name from unscoped package key', () => {
		expect(fix_gh_packages_logic.package_path_from_key(UNSCOPED_PKG_KEY)).toBe('react')
	})
})

describe('fix_gh_packages_logic.package_version_from_key', () => {
	it('extracts version from scoped package key', () => {
		expect(fix_gh_packages_logic.package_version_from_key(PKG_KEY)).toBe('0.142.0')
	})

	it('strips peer dependency suffix from version', () => {
		expect(
			fix_gh_packages_logic.package_version_from_key(`@scope/pkg@1.0.0(${UNSCOPED_PKG_KEY})`),
		).toBe('1.0.0')
	})

	it('extracts version from unscoped package key', () => {
		expect(fix_gh_packages_logic.package_version_from_key(UNSCOPED_PKG_KEY)).toBe('18.0.0')
	})
})

describe('fix_gh_packages_logic.insert_tarball_for_key - insertion', () => {
	it('inserts tarball line after integrity', () => {
		const result = fix_gh_packages_logic.insert_tarball_for_key(
			LOCKFILE_WITH_ENTRY,
			PKG_KEY,
			TARBALL_URL,
		)

		expect(result).toContain(`      tarball: ${TARBALL_URL}`)
	})

	it('places tarball line immediately after integrity line', () => {
		const result = fix_gh_packages_logic.insert_tarball_for_key(
			LOCKFILE_WITH_ENTRY,
			PKG_KEY,
			TARBALL_URL,
		)
		const integrity_pos = result.indexOf(`      integrity: ${INTEGRITY}`)
		const tarball_pos = result.indexOf(`      tarball: ${TARBALL_URL}`)

		expect(integrity_pos).toBeLessThan(tarball_pos)
		expect(tarball_pos - integrity_pos).toBe(`      integrity: ${INTEGRITY}\n`.length)
	})
})

describe('fix_gh_packages_logic.insert_tarball_for_key - edge cases', () => {
	it('is idempotent when tarball is already present', () => {
		const with_tarball = fix_gh_packages_logic.insert_tarball_for_key(
			LOCKFILE_WITH_ENTRY,
			PKG_KEY,
			TARBALL_URL,
		)

		expect(fix_gh_packages_logic.insert_tarball_for_key(with_tarball, PKG_KEY, TARBALL_URL)).toBe(
			with_tarball,
		)
	})

	it('returns content unchanged for unknown key', () => {
		expect(
			fix_gh_packages_logic.insert_tarball_for_key(
				LOCKFILE_WITH_ENTRY,
				'@unknown/pkg@9.9.9',
				TARBALL_URL,
			),
		).toBe(LOCKFILE_WITH_ENTRY)
	})

	it('does not corrupt other entries when multiple packages are present', () => {
		const content =
			`lockfileVersion: '9.0'\n\npackages:\n\n` +
			`  '${PKG_KEY}':\n    resolution:\n      integrity: ${INTEGRITY}\n\n` +
			`  '${OTHER_PKG_KEY}':\n    resolution:\n      integrity: sha512-other\n\nsnapshots:\n`
		const result = fix_gh_packages_logic.insert_tarball_for_key(content, PKG_KEY, TARBALL_URL)

		expect(result).toContain(
			`  '${OTHER_PKG_KEY}':\n    resolution:\n      integrity: sha512-other\n`,
		)
		expect(result).not.toContain(`  '${OTHER_PKG_KEY}':\n    resolution:\n      tarball:`)
	})
})

const FLOW_LOCKFILE_WITH_ENTRY = `lockfileVersion: '9.0'\n\npackages:\n\n  '${PKG_KEY}':\n    resolution: {integrity: ${INTEGRITY}}\n\nsnapshots:\n`

describe('fix_gh_packages_logic.insert_tarball_for_key - flow-style insertion', () => {
	it('inserts tarball before closing brace in flow-style resolution', () => {
		const result = fix_gh_packages_logic.insert_tarball_for_key(
			FLOW_LOCKFILE_WITH_ENTRY,
			PKG_KEY,
			TARBALL_URL,
		)

		expect(result).toContain(`{integrity: ${INTEGRITY}, tarball: ${TARBALL_URL}}`)
	})

	it('does not add expanded-YAML tarball line to flow-style entry', () => {
		const result = fix_gh_packages_logic.insert_tarball_for_key(
			FLOW_LOCKFILE_WITH_ENTRY,
			PKG_KEY,
			TARBALL_URL,
		)

		expect(result).not.toContain(`      tarball: ${TARBALL_URL}`)
	})
})

const TARBALL_FIRST_FLOW_LOCKFILE = `lockfileVersion: '9.0'\n\npackages:\n\n  '${PKG_KEY}':\n    resolution: {tarball: ${TARBALL_URL}, integrity: ${INTEGRITY}}\n\nsnapshots:\n`

describe('fix_gh_packages_logic.insert_tarball_for_key - flow-style edge cases', () => {
	it('is idempotent when tarball already present in flow-style resolution', () => {
		const with_tarball = fix_gh_packages_logic.insert_tarball_for_key(
			FLOW_LOCKFILE_WITH_ENTRY,
			PKG_KEY,
			TARBALL_URL,
		)

		expect(fix_gh_packages_logic.insert_tarball_for_key(with_tarball, PKG_KEY, TARBALL_URL)).toBe(
			with_tarball,
		)
	})

	it('returns unchanged when tarball is first field in flow-style resolution', () => {
		expect(
			fix_gh_packages_logic.insert_tarball_for_key(
				TARBALL_FIRST_FLOW_LOCKFILE,
				PKG_KEY,
				TARBALL_URL,
			),
		).toBe(TARBALL_FIRST_FLOW_LOCKFILE)
	})
})

describe('fix_gh_packages_logic.resolve_token', () => {
	it('returns env token when all three are present', () => {
		expect(fix_gh_packages_logic.resolve_token('env-tok', 'npmrc-tok', () => 'gh-tok')).toBe(
			'env-tok',
		)
	})

	it('returns npmrc token when env is absent', () => {
		expect(fix_gh_packages_logic.resolve_token(undefined, 'npmrc-tok', () => 'gh-tok')).toBe(
			'npmrc-tok',
		)
	})

	it('returns gh token when env and npmrc are absent', () => {
		expect(fix_gh_packages_logic.resolve_token(undefined, undefined, () => 'gh-tok')).toBe('gh-tok')
	})

	it('returns undefined when fallback returns undefined', () => {
		const absent: string | undefined = undefined

		expect(fix_gh_packages_logic.resolve_token(undefined, undefined, () => absent)).toBeUndefined()
	})

	it('does not call fallback when env token is present', () => {
		let is_called = false

		fix_gh_packages_logic.resolve_token('env-tok', undefined, () => {
			is_called = true

			return 'gh-tok'
		})

		expect(is_called).toBe(false)
	})

	it('skips empty-string env token and returns npmrc token', () => {
		expect(fix_gh_packages_logic.resolve_token('', 'npmrc-tok', () => 'gh-tok')).toBe('npmrc-tok')
	})
})

const OTHER_TARBALL_URL = 'https://npm.pkg.github.com/download/@joshuafolkken/other/1.0.0/xyz'

describe('fix_gh_packages_logic.patch_lockfile', () => {
	it('applies multiple patches', () => {
		const content =
			`lockfileVersion: '9.0'\n\npackages:\n\n` +
			`  '${PKG_KEY}':\n    resolution:\n      integrity: sha512-a\n\n` +
			`  '${OTHER_PKG_KEY}':\n    resolution:\n      integrity: sha512-b\n\nsnapshots:\n`
		const patches = new Map([
			[PKG_KEY, TARBALL_URL],
			[OTHER_PKG_KEY, OTHER_TARBALL_URL],
		])
		const result = fix_gh_packages_logic.patch_lockfile(content, patches)

		expect(result).toContain(`      tarball: ${TARBALL_URL}`)
		expect(result).toContain(`      tarball: ${OTHER_TARBALL_URL}`)
	})

	it('returns content unchanged when patches map is empty', () => {
		expect(fix_gh_packages_logic.patch_lockfile(LOCKFILE_WITH_ENTRY, new Map())).toBe(
			LOCKFILE_WITH_ENTRY,
		)
	})
})
