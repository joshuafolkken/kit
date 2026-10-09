import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { package_path } from '#scripts/init/init-paths'
import { execaSync } from 'execa'
import { afterEach, describe, expect, it } from 'vitest'

const GIT = 'git'
const GITIGNORE = '.gitignore'
const roots: Array<string> = []

function is_ignored_by(gitignore_source: string, relative_path: string): boolean {
	const root = mkdtempSync(path.join(os.tmpdir(), 'josh-gitignore-'))

	roots.push(root)
	execaSync(GIT, ['init', '--quiet'], { cwd: root })
	copyFileSync(package_path(gitignore_source), path.join(root, GITIGNORE))

	return (
		execaSync(GIT, ['check-ignore', '--quiet', relative_path], { cwd: root, reject: false })
			.exitCode === 0
	)
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// .claude/tmp/ holds a session's throwaway drafts (Issue / PR bodies, plans, handoffs);
// the distributed template carries the rule to every consumer through josh sync.
describe.each([GITIGNORE, 'templates/gitignore'])('%s', (gitignore_source) => {
	it.each(['.claude/tmp/handoff-1.json', '.claude/tmp/pr-body-1.md', '.claude/tmp/nested/plan.md'])(
		'ignores %s',
		(relative_path) => {
			expect(is_ignored_by(gitignore_source, relative_path)).toBe(true)
		},
	)

	it('keeps the rest of .claude/ tracked', () => {
		expect(is_ignored_by(gitignore_source, '.claude/settings.json')).toBe(false)
	})
})
