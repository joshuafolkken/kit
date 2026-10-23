import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#4634: the sonar file goes through `write_contained` like every other sync write,
// so a `sonar-project.properties` linked outside the project is refused rather than written through.
// The project root is pinned to a scratch tree, as `file-content.test.ts` does.

const SANDBOX = mkdtempSync(path.join(tmpdir(), 'sonar-contained-'))
const ROOT = path.join(SANDBOX, 'project')
const OUTSIDE_FILE = path.join(SANDBOX, 'outside.properties')
const TEMPLATE = path.join(SANDBOX, 'template.properties')
const DESTINATION = path.join(ROOT, 'sonar-project.properties')
const OUTSIDE_CONTENT = 'sonar.projectKey=outside\n'
const IDENTIFIERS = { project_key: 'org_repo', organization: 'org' }

mkdirSync(ROOT)
vi.doMock('#scripts/init/init-paths', async (import_original) => ({
	...(await import_original<Record<string, unknown>>()),
	PROJECT_ROOT: ROOT,
}))

const { sonar_file } = await import('./sonar-file')

beforeEach(() => {
	rmSync(DESTINATION, { force: true })
	writeFileSync(TEMPLATE, 'sonar.projectKey={{PROJECT_KEY}}\nsonar.organization={{ORGANIZATION}}\n')
	writeFileSync(OUTSIDE_FILE, OUTSIDE_CONTENT)
	symlinkSync(OUTSIDE_FILE, DESTINATION)
})

afterAll(() => {
	rmSync(SANDBOX, { recursive: true, force: true })
})

describe('sonar_file — a destination linked outside the project', () => {
	it.each([
		['write_sonar_file', sonar_file.write_sonar_file],
		['merge_sonar_file', sonar_file.merge_sonar_file],
	])('%s refuses it and leaves the outside file alone', (_name, write) => {
		expect(() => {
			write(TEMPLATE, DESTINATION, IDENTIFIERS)
		}).toThrow(/resolves outside the project/u)
		expect(readFileSync(OUTSIDE_FILE, 'utf8')).toBe(OUTSIDE_CONTENT)
	})
})
