import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#4666: `.aikido` goes through `write_contained` like every other sync write, so a
// dangling link to outside the project (`.aikido` → `~/.zshenv`) is refused rather than written
// through. The project root is pinned to a scratch tree, as `file-content.test.ts` does.

const SANDBOX = mkdtempSync(path.join(tmpdir(), 'safe-chain-contained-'))
const ROOT = path.join(SANDBOX, 'project')
const OUTSIDE_FILE = path.join(SANDBOX, 'outside.zshenv')
const DESTINATION = path.join(ROOT, '.aikido')

mkdirSync(ROOT)
vi.doMock('#scripts/init/init-paths', async (import_original) => ({
	...(await import_original<Record<string, unknown>>()),
	PROJECT_ROOT: ROOT,
}))

const { project_config } = await import('./project-config')

afterAll(() => {
	rmSync(SANDBOX, { recursive: true, force: true })
})

describe('project_config.sync_project_config — a .aikido linked outside the project', () => {
	it('refuses the write and creates nothing outside', () => {
		writeFileSync(path.join(ROOT, 'pnpm-workspace.yaml'), 'minimumReleaseAgeExclude:\n  - vite\n')
		symlinkSync(OUTSIDE_FILE, DESTINATION)

		expect(() => project_config.sync_project_config(ROOT)).toThrow(/resolves outside the project/u)
		expect(existsSync(OUTSIDE_FILE)).toBe(false)
	})
})
