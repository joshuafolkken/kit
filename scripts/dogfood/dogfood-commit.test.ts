import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execaSync } from 'execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dogfood_commit_cli } from './dogfood-commit-cli'

// joshuafolkken/kit#3142: the one sanctioned route to a dogfood test project's first commit. It
// commits a fresh `kit-test-*` directory — empty or with a history-less `.git` — and refuses the kit
// checkout, a repository with history, a directory inside another repository and any other name.

const TEST_PROJECT = 'kit-test-sample'
const MAIN = 'main'
const INITIAL_COMMIT = 'Initial commit'
const LOG_SUBJECTS = ['log', '--format=%s']
const CURRENT_BRANCH = ['branch', '--show-current']
const INIT_MAIN = ['init', `--initial-branch=${MAIN}`]
const PAGE = 'index.html'
const EXISTING_WORK = 'Existing work'
const IDENTITY = 'Dogfood'
const IDENTITY_EMAIL = 'dogfood@example.com'
const fixture = { sandbox: '', kit_root: '' }

function git(cwd: string, args: ReadonlyArray<string>): string {
	return execaSync('git', args, { cwd }).stdout.trim()
}

function make_project(parent: string, name: string = TEST_PROJECT): string {
	const directory = path.join(parent, name)

	mkdirSync(directory, { recursive: true })
	writeFileSync(path.join(directory, PAGE), '<p>hello</p>\n')

	return directory
}

function run(target: string): number {
	return dogfood_commit_cli.run([target], fixture.kit_root)
}

beforeEach(() => {
	const sandbox = mkdtempSync(path.join(os.tmpdir(), 'dogfood-commit-'))

	fixture.sandbox = realpathSync(sandbox)
	fixture.kit_root = path.join(fixture.sandbox, 'kit')
	mkdirSync(fixture.kit_root)
	// A machine's own git settings (signing, hooks, identity) must not decide the outcome.
	vi.stubEnv('GIT_CONFIG_GLOBAL', os.devNull)
	vi.stubEnv('GIT_AUTHOR_NAME', IDENTITY)
	vi.stubEnv('GIT_AUTHOR_EMAIL', IDENTITY_EMAIL)
	vi.stubEnv('GIT_COMMITTER_NAME', IDENTITY)
	vi.stubEnv('GIT_COMMITTER_EMAIL', IDENTITY_EMAIL)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
	rmSync(fixture.sandbox, { recursive: true, force: true })
})

describe('dogfood_commit_cli.run — commits', () => {
	it('creates the repository and its Initial commit on main in an empty test project', () => {
		const project = make_project(fixture.sandbox)

		expect(run(project)).toBe(0)
		expect(git(project, LOG_SUBJECTS)).toBe(INITIAL_COMMIT)
		expect(git(project, CURRENT_BRANCH)).toBe(MAIN)
		expect(git(project, ['ls-files'])).toBe(PAGE)
	})

	it('commits a test project whose .git has no history yet, renaming master to main', () => {
		const project = make_project(fixture.sandbox)

		git(project, ['init', '--initial-branch=master'])

		expect(run(project)).toBe(0)
		expect(git(project, LOG_SUBJECTS)).toBe(INITIAL_COMMIT)
		expect(git(project, CURRENT_BRANCH)).toBe(MAIN)
	})
})

describe('dogfood_commit_cli.run — refuses and changes nothing', () => {
	it('refuses a repository that already has commits', () => {
		const project = make_project(fixture.sandbox)

		git(project, INIT_MAIN)
		git(project, ['add', '--all'])
		git(project, ['commit', '--no-verify', '--message', EXISTING_WORK])

		expect(run(project)).toBe(1)
		expect(git(project, LOG_SUBJECTS)).toBe(EXISTING_WORK)
	})

	it('refuses the kit checkout and a test project inside it', () => {
		const inside = make_project(fixture.kit_root)
		const elsewhere = path.join(fixture.sandbox, TEST_PROJECT)

		expect(run(inside)).toBe(1)
		expect(dogfood_commit_cli.run([fixture.kit_root], elsewhere)).toBe(1)
	})

	it('refuses a test project inside another repository', () => {
		const outer = make_project(fixture.sandbox, 'outer')
		const inner = make_project(outer)

		git(outer, INIT_MAIN)

		expect(run(inner)).toBe(1)
		expect(git(outer, ['status', '--porcelain'])).toContain('??')
	})

	it('refuses a directory not named kit-test-*, a missing directory and no argument', () => {
		const other = make_project(fixture.sandbox, 'my-app')

		expect(run(other)).toBe(1)
		expect(run(path.join(fixture.sandbox, 'kit-test-missing'))).toBe(1)
		expect(dogfood_commit_cli.run([], fixture.kit_root)).toBe(1)
	})
})

describe('dogfood_commit_cli.run — reads the name from the resolved directory', () => {
	it('refuses a kit-test-* symlink to a directory of another name', () => {
		const other = make_project(fixture.sandbox, 'my-app')
		const link = path.join(fixture.sandbox, TEST_PROJECT)

		symlinkSync(other, link)

		expect(run(link)).toBe(1)
		expect(existsSync(path.join(other, '.git'))).toBe(false)
	})
})
