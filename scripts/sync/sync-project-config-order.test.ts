import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SYNC_SOURCE = readFileSync(new URL('sync.ts', import.meta.url), 'utf8')
const ARTIFACTS_HEADER = 'function sync_project_artifacts('

function artifacts_body(): string {
	const start = SYNC_SOURCE.indexOf(ARTIFACTS_HEADER)
	if (start === -1) throw new Error('sync_project_artifacts not found')
	const end = SYNC_SOURCE.indexOf('\n}\n', start)

	return SYNC_SOURCE.slice(start, end)
}

// `.aikido`'s Safe Chain age is derived from `pnpm-workspace.yaml`, which `sync_ai_copy_all` may add
// the window to; syncing `.aikido` first would copy the pre-sync window until a second run
// (joshuafolkken/kit#2743, #3267).
describe('sync_project_artifacts ordering', () => {
	it('syncs the Safe Chain project config after the workspace file', () => {
		const body = artifacts_body()
		const config_files_at = body.indexOf('sync_ai_files.sync_ai_copy_all(')
		const project_config_at = body.indexOf('project_config.sync_project_config(')

		expect(config_files_at).toBeGreaterThan(-1)
		expect(project_config_at).toBeGreaterThan(config_files_at)
	})
})
