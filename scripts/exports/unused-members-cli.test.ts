import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { unused_members_fixture } from '#tools/exports/unused-members-fixture'
import { describe, expect, it } from 'vitest'

const { create_project, with_reader, READ_KEPT } = unused_members_fixture
const CLI = fileURLToPath(new URL('unused-members-cli.ts', import.meta.url))
const PACKAGE_DIRECTORY = path.dirname(
	fileURLToPath(new URL('../../package.json', import.meta.url)),
)
const SPAWN_TIMEOUT_MS = 30_000
const DROPPED_LINE = 'library.ts:3  library.dropped'

describe('unused-members CLI', () => {
	it(
		'scans the project it runs in and fails on an unused member',
		() => {
			const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), CLI], {
				cwd: create_project(with_reader(READ_KEPT)),
				encoding: 'utf8',
			})

			expect(result.status).toBe(1)
			expect(result.stderr).toContain(DROPPED_LINE)
		},
		SPAWN_TIMEOUT_MS,
	)

	// joshuafolkken/kit#7829: `josh lint:related`'s child names the changed files.
	it(
		'narrows the scan to the namespaces the given files declare or import',
		() => {
			const root = create_project([...with_reader(READ_KEPT), ['other.ts', 'export const a = 1']])
			const result = spawnSync(
				process.execPath,
				['--import', import.meta.resolve('tsx'), CLI, path.join(root, 'other.ts')],
				{ cwd: root, encoding: 'utf8' },
			)

			expect(result.status).toBe(0)
			expect(result.stdout).toContain('no unused namespace member')
		},
		SPAWN_TIMEOUT_MS,
	)
})

// joshuafolkken/kit#8203: `josh lint:related`'s child starts the bundle, whose `argv[1]` is not the source.
describe('unused-members CLI — started as its bundle', () => {
	it(
		'scans when argv[1] is the bundle path',
		() => {
			const bundle = path.join(PACKAGE_DIRECTORY, 'dist', 'commands', 'unused-members-cli.js')
			const start = `process.argv = [process.execPath, ${JSON.stringify(bundle)}]; await import(${JSON.stringify(pathToFileURL(CLI).href)})`
			const result = spawnSync(
				process.execPath,
				['--import', import.meta.resolve('tsx'), '--input-type=module', '--eval', start],
				{ cwd: create_project(with_reader(READ_KEPT)), encoding: 'utf8' },
			)

			expect(result.status).toBe(1)
			expect(result.stderr).toContain(DROPPED_LINE)
		},
		SPAWN_TIMEOUT_MS,
	)
})
