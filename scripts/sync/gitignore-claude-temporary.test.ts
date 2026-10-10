import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { git_location_environment } from '#scripts/git/git-location-environment'
import { package_path } from '#scripts/init/init-paths'
import { run_cut_handoff } from '#scripts/run/cut/run-cut-handoff'
import { execaSync } from 'execa'
import { afterEach, describe, expect, it } from 'vitest'

const GIT = 'git'
const GITIGNORE = '.gitignore'
const roots: Array<string> = []
// Under the pre-push hook git exports GIT_DIR / GIT_INDEX_FILE, which beat `cwd` — cleared so each
// call answers about the scratch repository instead of the checkout the hook is firing in.
const SCRATCH_ENVIRONMENT = git_location_environment.location_free_environment()

function is_ignored_by(gitignore_source: string, relative_path: string): boolean {
	const root = mkdtempSync(path.join(os.tmpdir(), 'josh-gitignore-'))

	roots.push(root)
	execaSync(GIT, ['init', '--quiet'], { cwd: root, env: SCRATCH_ENVIRONMENT })
	copyFileSync(package_path(gitignore_source), path.join(root, GITIGNORE))

	return (
		execaSync(GIT, ['check-ignore', '--quiet', relative_path], {
			cwd: root,
			env: SCRATCH_ENVIRONMENT,
			reject: false,
		}).exitCode === 0
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

	// The names run handoff notes were once written under, beside the code they were committed with
	// (joshuafolkken/kit#3603); `HANDOFF_PATH` is where one is written now.
	it.each([
		'.git-handoff-3360.json',
		'.josh-handoff-3399.json',
		'.josh/handoff-3502.json',
		run_cut_handoff.HANDOFF_PATH,
	])('ignores the run handoff note %s', (relative_path) => {
		expect(is_ignored_by(gitignore_source, relative_path)).toBe(true)
	})

	it('keeps the rest of .josh/ tracked', () => {
		expect(is_ignored_by(gitignore_source, '.josh/metrics-baseline.json')).toBe(false)
	})
})

// An ignore rule does not untrack a file already committed, so the rule alone would leave the notes
// in the repository.
describe('the checkout', () => {
	it('tracks no file its own .gitignore ignores', () => {
		const listed = execaSync(GIT, ['ls-files', '--cached', '--ignored', '--exclude-standard'], {
			cwd: package_path('.'),
			env: SCRATCH_ENVIRONMENT,
		})

		// The index still lists a file deleted but not yet committed; one that is gone is not kept. An
		// empty listing splits into one empty name, which resolves to the package root and exists.
		const kept = listed.stdout
			.split('\n')
			.filter((file) => file !== '' && existsSync(package_path(file)))

		expect(kept).toEqual([])
	})
})
