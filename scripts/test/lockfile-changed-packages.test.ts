import { describe, expect, it } from 'vitest'
import { lockfile_changed_packages } from './lockfile-changed-packages'

// joshuafolkken/kit#7554: a lockfile change reaches the packages it moved and every package depending
// on one, unless it moved a unit runtime package or more than resolutions.

const HEADER = ['lockfileVersion: "9.0"', 'importers:', '  .:']
const SELF_DOCUMENT = [...HEADER, '    configDependencies: {}']
const DEPENDENCIES = '    dependencies:'
const SNAPSHOTS = 'snapshots:'

interface Versions {
	leaf: string
	runner?: string
	specifier?: string
}

// `leaf` ← `middle` ← `parent`, the root's one dependency; `other` and the runner depend on nothing.
function entries_of(versions: Versions): Array<string> {
	const { leaf, runner = '1.0.0' } = versions

	return [`  leaf@${leaf}: {}`, '  other@1.0.0: {}', `  vitest@${runner}: {}`]
}

function project_document(versions: Versions): Array<string> {
	const { leaf, specifier = '^1.0.0' } = versions

	return [
		...HEADER,
		DEPENDENCIES,
		'      parent:',
		`        specifier: ${specifier}`,
		'        version: 1.0.0',
		'packages:',
		...entries_of(versions),
		'  middle@1.0.0: {}',
		'  parent@1.0.0: {}',
		SNAPSHOTS,
		...entries_of(versions),
		'  middle@1.0.0:',
		DEPENDENCIES,
		`      leaf: ${leaf}`,
		'  parent@1.0.0(peer@2.0.0):',
		DEPENDENCIES,
		'      middle: 1.0.0',
	]
}

function lockfile_of(versions: Versions): string {
	return [...SELF_DOCUMENT, '---', ...project_document(versions)].join('\n')
}

const BEFORE = lockfile_of({ leaf: '1.0.0' })

// The runner depends on `pool`; `@vitest/expect` stands for the runner's scoped packages.
function runtime_lockfile(pool: string, expect_version: string): string {
	return [
		...HEADER,
		'    dependencies: {}',
		SNAPSHOTS,
		`  pool@${pool}: {}`,
		`  '@vitest/expect@${expect_version}': {}`,
		'  vitest@1.0.0:',
		DEPENDENCIES,
		`      pool: ${pool}`,
	].join('\n')
}

const RUNTIME_BEFORE = runtime_lockfile('1.0.0', '1.0.0')

describe('lockfile_changed_packages.affected_packages', () => {
	it('answers the moved package with every package depending on it, however far', () => {
		const affected = lockfile_changed_packages.affected_packages(
			BEFORE,
			lockfile_of({ leaf: '1.0.1' }),
		)

		expect(affected).toStrictEqual(new Set(['leaf', 'middle', 'parent']))
	})

	it('answers no package when nothing moved', () => {
		expect(lockfile_changed_packages.affected_packages(BEFORE, BEFORE)).toStrictEqual(new Set())
	})

	it('answers undefined when a unit runtime package moved', () => {
		const after = lockfile_of({ leaf: '1.0.0', runner: '1.1.0' })

		expect(lockfile_changed_packages.affected_packages(BEFORE, after)).toBeUndefined()
	})

	it('answers undefined when a package the unit runtime depends on moved', () => {
		const after = runtime_lockfile('1.0.1', '1.0.0')

		expect(lockfile_changed_packages.affected_packages(RUNTIME_BEFORE, after)).toBeUndefined()
	})

	it('answers undefined when a scoped unit runtime package moved', () => {
		const after = runtime_lockfile('1.0.0', '1.0.1')

		expect(lockfile_changed_packages.affected_packages(RUNTIME_BEFORE, after)).toBeUndefined()
	})

	it('answers undefined when a root importer moved more than its resolved versions', () => {
		const after = lockfile_of({ leaf: '1.0.0', specifier: '^1.1.0' })

		expect(lockfile_changed_packages.affected_packages(BEFORE, after)).toBeUndefined()
	})

	it('answers undefined when either side cannot be read, or the documents differ in number', () => {
		const project_only = project_document({ leaf: '1.0.0' }).join('\n')

		expect(lockfile_changed_packages.affected_packages('a: [', BEFORE)).toBeUndefined()
		expect(lockfile_changed_packages.affected_packages(BEFORE, '- 1')).toBeUndefined()
		expect(lockfile_changed_packages.affected_packages(BEFORE, project_only)).toBeUndefined()
	})
})
