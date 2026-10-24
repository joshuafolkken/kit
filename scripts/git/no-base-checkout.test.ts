import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git_fixture_workspace, type FixtureWorkspace } from './git-fixture-workspace'
import { no_base_checkout } from './no-base-checkout'

const fixture: FixtureWorkspace = {
	previous_cwd: '',
	restore_environment: undefined,
	workspace: '',
}
const checkout = { directory: '' }

const EDITED = 'edited.ts'
const ADDED = 'added.ts'
const DELETED = 'deleted.ts'
const NESTED = 'nested'
const EDITED_TEXT = 'export const value = 2\n'
const ORIGIN_URL = 'https://github.com/example-owner/example-repo.git'
const ORIGIN_URL_KEY = 'remote.origin.url'

async function git(cwd: string, arguments_: ReadonlyArray<string>): Promise<string> {
	return await git_fixture_workspace.git(cwd, arguments_)
}

async function commit_all(message: string): Promise<void> {
	await git(fixture.workspace, ['add', '--all'])
	await git(fixture.workspace, ['commit', '--quiet', '-m', message])
}

// Two commits on `main`, then work in progress of every kind: an edit, a new file, a deletion.
async function build_repository(): Promise<void> {
	const { workspace } = fixture

	await git(workspace, ['init', '--quiet', git_fixture_workspace.MAIN_BRANCH])
	writeFileSync(path.join(workspace, EDITED), 'export const value = 1\n')
	await commit_all('first')
	writeFileSync(path.join(workspace, DELETED), 'export const gone = 1\n')
	await commit_all('second')
	writeFileSync(path.join(workspace, EDITED), EDITED_TEXT)
	writeFileSync(path.join(workspace, ADDED), 'export const added = 1\n')
	rmSync(path.join(workspace, DELETED))
}

async function open_checkout(): Promise<void> {
	Object.assign(fixture, git_fixture_workspace.open_workspace('kit-no-base-checkout-'))
	await build_repository()
	process.chdir(fixture.workspace)
	checkout.directory = await no_base_checkout.create(fixture.workspace)
}

async function close_checkout(): Promise<void> {
	no_base_checkout.remove(checkout.directory)
	await git_fixture_workspace.close_workspace(fixture)
}

describe('no_base_checkout', () => {
	beforeEach(open_checkout)
	afterEach(close_checkout)

	it('fails a diff against a bare main, which the repository it was cut from passes', async () => {
		await expect(git(fixture.workspace, ['diff', '--name-only', 'main'])).resolves.toContain(EDITED)
		await expect(git(checkout.directory, ['diff', 'main'])).rejects.toThrow(
			/(?:unknown|bad) revision/u,
		)
	})

	it('is at the same commit, detached and one commit deep, as CI checks out', async () => {
		const head = await git(fixture.workspace, ['rev-parse', 'HEAD'])

		await expect(git(checkout.directory, ['rev-parse', 'HEAD'])).resolves.toBe(head)
		await expect(git(checkout.directory, ['rev-list', '--count', 'HEAD'])).resolves.toBe('1')
		await expect(git(checkout.directory, ['symbolic-ref', '--quiet', 'HEAD'])).rejects.toThrow()
	})

	it('carries the work in progress over the checked-out tree', () => {
		const { directory } = checkout

		expect(readFileSync(path.join(directory, EDITED), 'utf8')).toBe(EDITED_TEXT)
		expect(existsSync(path.join(directory, ADDED))).toBe(true)
		expect(existsSync(path.join(directory, DELETED))).toBe(false)
	})

	it('leaves nothing behind once removed', () => {
		no_base_checkout.remove(checkout.directory)

		expect(existsSync(checkout.directory)).toBe(false)
	})
})

describe('no_base_checkout — the origin remote', () => {
	beforeEach(open_checkout)
	afterEach(close_checkout)

	it('declares no origin when the repository it was cut from has none', async () => {
		await expect(git(checkout.directory, ['config', '--get', ORIGIN_URL_KEY])).rejects.toThrow()
	})

	it('declares the origin of the repository it was cut from, and fetches no ref from it', async () => {
		await git(fixture.workspace, ['config', ORIGIN_URL_KEY, ORIGIN_URL])
		const directory = await no_base_checkout.create(fixture.workspace)
		const remote_url = git(directory, ['config', '--get', ORIGIN_URL_KEY])
		const branches = git(directory, ['for-each-ref', 'refs/remotes', 'refs/heads'])

		await expect(remote_url).resolves.toBe(ORIGIN_URL)
		await expect(branches).resolves.toBe('')
		no_base_checkout.remove(directory)
	})
})

describe('no_base_checkout — untracked directories', () => {
	beforeEach(open_checkout)
	afterEach(close_checkout)

	it('passes over an untracked nested repository, which git lists as a directory', async () => {
		await git(fixture.workspace, ['init', '--quiet', NESTED])
		writeFileSync(path.join(fixture.workspace, NESTED, ADDED), 'export const nested = 1\n')
		const directory = await no_base_checkout.create(fixture.workspace)

		no_base_checkout.remove(directory)

		expect(existsSync(directory)).toBe(false)
	})
})
