import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#4666: `.github/dependabot.yml` goes through `write_contained` like every other
// sync write, so one linked outside the project is refused rather than written through. The project
// root is pinned to a scratch tree, as `file-content.test.ts` does.

const SANDBOX = mkdtempSync(path.join(tmpdir(), 'dependabot-contained-'))
const ROOT = path.join(SANDBOX, 'project')
const OUTSIDE_FILE = path.join(SANDBOX, 'outside.yml')
const DESTINATION = path.join(ROOT, '.github', 'dependabot.yml')
const OUTSIDE_CONTENT = [
	'version: 2',
	'updates:',
	"  - package-ecosystem: 'npm'",
	"    directory: '/'",
	'',
].join('\n')

mkdirSync(path.dirname(DESTINATION), { recursive: true })
vi.doMock('#scripts/init/init-paths', async (import_original) => ({
	...(await import_original<Record<string, unknown>>()),
	PROJECT_ROOT: ROOT,
}))

const { dependabot_cooldown } = await import('./dependabot-cooldown')

afterAll(() => {
	rmSync(SANDBOX, { recursive: true, force: true })
})

describe('dependabot_cooldown.sync_dependabot_cooldown — a config linked outside the project', () => {
	it('refuses the write and leaves the outside file alone', () => {
		writeFileSync(OUTSIDE_FILE, OUTSIDE_CONTENT)
		symlinkSync(OUTSIDE_FILE, DESTINATION)

		expect(() => dependabot_cooldown.sync_dependabot_cooldown(ROOT)).toThrow(
			/resolves outside the project/u,
		)
		expect(readFileSync(OUTSIDE_FILE, 'utf8')).toBe(OUTSIDE_CONTENT)
	})
})
