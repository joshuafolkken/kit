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
// The copy also overwrites `.github/dependabot.yml` with kit's own, so the cooldown is derived after
// it for the same reason (kit #4023).
describe('sync_project_artifacts ordering', () => {
	it('syncs the release-window mirrors after the copied files', () => {
		const body = artifacts_body()
		const copy_at = body.indexOf('sync_ai_files.sync_ai_copy_all(')
		const mirrors_at = body.indexOf('sync_release_window_mirrors(')

		expect(copy_at).toBeGreaterThan(-1)
		expect(mirrors_at).toBeGreaterThan(copy_at)
	})

	it('mirrors the window into both .aikido and the Dependabot cooldown', () => {
		expect(SYNC_SOURCE).toContain('project_config.sync_project_config(root)')
		expect(SYNC_SOURCE).toContain('dependabot_cooldown.sync_dependabot_cooldown(root)')
	})
})
