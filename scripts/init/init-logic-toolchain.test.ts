import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { init_logic_toolchain } from './init-logic-toolchain'

const KIT_MANIFEST = JSON.parse(
	readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { peerDependencies: Record<string, string>; devDependencies: Record<string, string> }
const LEFTHOOK = 'lefthook'
const ESLINT = 'eslint'
const OLDER_RANGE = '^1.0.0'
const WITH_GIT = init_logic_toolchain.consumer_resolved_names(true)
const KIT_ONLY_PEERS = Object.keys(KIT_MANIFEST.peerDependencies).filter(
	(name) => !WITH_GIT.includes(name),
)

function synced_deps(manifest: object, has_git = true): Record<string, string> {
	const merged = init_logic_toolchain.merge_consumer_resolved_development_deps(
		JSON.stringify(manifest),
		has_git,
	)
	const parsed = JSON.parse(merged) as { devDependencies?: Record<string, string> }

	return parsed.devDependencies ?? {}
}

describe('consumer_resolved_names', () => {
	it.each(WITH_GIT)('carries the range kit itself develops against: %s', (name) => {
		expect(KIT_MANIFEST.devDependencies[name]).toBeDefined()
	})

	it.each(WITH_GIT)('names a tool josh init adds too: %s', (name) => {
		const added = init_logic_toolchain.get_toolchain_development_dependencies(true)

		expect(added[name]).toBe(KIT_MANIFEST.devDependencies[name])
	})

	it('leaves lefthook out for a project without Git', () => {
		expect(WITH_GIT).toContain(LEFTHOOK)
		expect(init_logic_toolchain.consumer_resolved_names(false)).not.toContain(LEFTHOOK)
	})
})

describe('get_toolchain_development_dependencies', () => {
	// `josh init` keeps writing every kit peer, the ones only kit's own configs import included.
	it('still covers every kit peer', () => {
		const added = init_logic_toolchain.get_toolchain_development_dependencies(true)

		for (const name of Object.keys(KIT_MANIFEST.peerDependencies)) {
			expect(added[name], name).toBe(KIT_MANIFEST.devDependencies[name])
		}
	})
})

describe('merge_consumer_resolved_development_deps', () => {
	it('adds every missing tool at the range kit carries', () => {
		const deps = synced_deps({ name: 'demo' })

		for (const name of WITH_GIT) expect(deps[name], name).toBe(KIT_MANIFEST.devDependencies[name])
	})

	it('adds only the tool that is missing', () => {
		const present = Object.fromEntries(
			WITH_GIT.filter((name) => name !== LEFTHOOK).map((name) => [name, OLDER_RANGE]),
		)
		const deps = synced_deps({ devDependencies: present })

		expect(deps).toStrictEqual({ ...present, [LEFTHOOK]: KIT_MANIFEST.devDependencies[LEFTHOOK] })
	})

	it('keeps a range that differs from the one kit carries', () => {
		expect(synced_deps({ devDependencies: { [ESLINT]: OLDER_RANGE } })[ESLINT]).toBe(OLDER_RANGE)
	})

	it.each(['dependencies', 'peerDependencies', 'optionalDependencies'])(
		'treats a tool listed under %s as present',
		(field) => {
			expect(synced_deps({ [field]: { [ESLINT]: OLDER_RANGE } })[ESLINT]).toBeUndefined()
		},
	)
})

describe('merge_consumer_resolved_development_deps — what it leaves out', () => {
	it('adds no tool only kit itself imports', () => {
		const deps = synced_deps({ name: 'demo' })

		expect(KIT_ONLY_PEERS).toContain('eslint-plugin-unicorn')
		for (const name of KIT_ONLY_PEERS) expect(deps[name], name).toBeUndefined()
	})

	it('adds everything but lefthook to a project without Git', () => {
		const deps = synced_deps({ name: 'demo' }, false)

		expect(deps[LEFTHOOK]).toBeUndefined()
		expect(deps[ESLINT]).toBe(KIT_MANIFEST.devDependencies[ESLINT])
	})

	it('returns a fully provisioned manifest byte-identical', () => {
		const content = JSON.stringify({
			dependencies: Object.fromEntries(WITH_GIT.map((name) => [name, '*'])),
		})

		expect(init_logic_toolchain.merge_consumer_resolved_development_deps(content, true)).toBe(
			content,
		)
	})
})
