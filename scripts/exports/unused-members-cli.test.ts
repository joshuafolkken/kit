import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { unused_members_fixture } from '#tools/exports/unused-members-fixture'
import { describe, expect, it } from 'vitest'

const { create_project, with_reader, READ_KEPT } = unused_members_fixture
const CLI = fileURLToPath(new URL('unused-members-cli.ts', import.meta.url))
const SPAWN_TIMEOUT_MS = 30_000

describe('unused-members CLI', () => {
	it(
		'scans the project it runs in and fails on an unused member',
		() => {
			const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), CLI], {
				cwd: create_project(with_reader(READ_KEPT)),
				encoding: 'utf8',
			})

			expect(result.status).toBe(1)
			expect(result.stderr).toContain('library.ts:3  library.dropped')
		},
		SPAWN_TIMEOUT_MS,
	)
})
