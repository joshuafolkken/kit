import { describe, expect, it } from 'vitest'
import { uninstall_plan, type DistributedFile } from './uninstall-plan'

const KIT = '@joshuafolkken/kit'
const KIT_CONTENT = 'kit content\n'
const UNTOUCHED = 'untouched.md'
const EDITED = 'edited.md'
const UNKNOWN = 'unknown.md'
const JOSH_SCRIPT = 'scripts.josh'
const FILES: Array<DistributedFile> = [
	{ dest: UNTOUCHED, distributed: KIT_CONTENT },
	{ dest: EDITED, distributed: KIT_CONTENT },
	{ dest: 'absent.md', distributed: KIT_CONTENT },
	{ dest: UNKNOWN, distributed: undefined },
]
const PROJECT_FILES = new Map([
	[UNTOUCHED, KIT_CONTENT],
	[EDITED, `${KIT_CONTENT}my line\n`],
	[UNKNOWN, KIT_CONTENT],
])
const KIT_MANIFEST = JSON.stringify({
	private: true,
	scripts: { preinstall: 'warn', josh: 'josh' },
	devDependencies: { [KIT]: '1.0.0', prettier: '^3.0.0' },
	packageManager: 'pnpm@12.0.0',
	josh: { profile: 'basic' },
})

function read_project_file(destination: string): string | undefined {
	return PROJECT_FILES.get(destination)
}

function stripped(manifest: Record<string, unknown>): unknown {
	return JSON.parse(uninstall_plan.strip_kit(JSON.stringify(manifest)))
}

describe('classify_files', () => {
	it('removes a file that still equals what kit writes', () => {
		expect(uninstall_plan.classify_files(FILES, read_project_file).remove).toStrictEqual([
			UNTOUCHED,
		])
	})

	it('keeps an edited file and one whose distributed content is unknown', () => {
		expect(uninstall_plan.classify_files(FILES, read_project_file).keep).toStrictEqual([
			EDITED,
			UNKNOWN,
		])
	})

	it('names a destination listed twice once', () => {
		const twice = [FILES[0], FILES[0]].filter((file) => file !== undefined)

		expect(uninstall_plan.classify_files(twice, read_project_file)).toStrictEqual({
			remove: [UNTOUCHED],
			keep: [],
		})
	})
})

describe('strip_kit', () => {
	it('takes out the kit dependency and the profile record, leaving the rest', () => {
		const manifest = {
			scripts: { josh: 'josh' },
			devDependencies: { [KIT]: '1.0.0', prettier: '^3.0.0' },
			josh: { profile: 'basic', other: true },
		}

		expect(stripped(manifest)).toStrictEqual({
			scripts: { josh: 'josh' },
			devDependencies: { prettier: '^3.0.0' },
			josh: { other: true },
		})
	})

	it('drops a field the removal leaves empty', () => {
		const manifest = {
			private: true,
			devDependencies: { [KIT]: '1.0.0' },
			josh: { profile: 'full' },
		}

		expect(stripped(manifest)).toStrictEqual({ private: true })
	})

	it('takes the kit dependency out of dependencies as well', () => {
		expect(stripped({ dependencies: { [KIT]: '1.0.0', left: '1.0.0' } })).toStrictEqual({
			dependencies: { left: '1.0.0' },
		})
	})

	it('refuses a manifest that is not an object', () => {
		expect(() => uninstall_plan.strip_kit('[]')).toThrow('package.json must contain an object')
	})
})

describe('has_kit_entries', () => {
	it('is true while the dependency or the profile record is present', () => {
		expect(uninstall_plan.has_kit_entries(KIT_MANIFEST)).toBe(true)
	})

	it('is false for a manifest without them, however it is indented', () => {
		expect(uninstall_plan.has_kit_entries('{ "scripts": { "josh": "josh" } }')).toBe(false)
	})
})

describe('manifest_review', () => {
	it('names every merged entry the project still holds', () => {
		expect(uninstall_plan.manifest_review(KIT_MANIFEST, KIT_MANIFEST)).toStrictEqual([
			'private',
			'scripts.preinstall',
			JOSH_SCRIPT,
			'devDependencies.prettier',
			'packageManager',
		])
	})

	it('names nothing the project does not hold', () => {
		const manifest = JSON.stringify({ scripts: { build: 'tsc', josh: 'josh' } })

		expect(uninstall_plan.manifest_review(manifest, KIT_MANIFEST)).toStrictEqual([JOSH_SCRIPT])
	})
})
