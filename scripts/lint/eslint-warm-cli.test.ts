import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'

const CLI = fileURLToPath(new URL('eslint-warm-cli.ts', import.meta.url))
const SPAWN_TIMEOUT_MS = 30_000
const make_directory = temporary_directory('suite')
const scratch = make_directory('eslint-warm-cli-')

// joshuafolkken/kit#4720: the detached warm-up runs unattended, so a checkout it cannot warm — no
// eslint installed, no repository — ends it quietly rather than with an uncaught failure.
describe('eslint-warm CLI', () => {
	it(
		'exits cleanly in a checkout with no eslint to warm',
		() => {
			const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), CLI], {
				cwd: scratch,
				encoding: 'utf8',
			})

			expect(result.status).toBe(0)
			expect(result.stderr).toBe('')
		},
		SPAWN_TIMEOUT_MS,
	)
})
