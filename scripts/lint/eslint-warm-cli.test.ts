import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const CLI = fileURLToPath(new URL('eslint-warm-cli.ts', import.meta.url))
const SPAWN_TIMEOUT_MS = 30_000
const scratch = mkdtempSync(path.join(tmpdir(), 'eslint-warm-cli-'))

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

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
