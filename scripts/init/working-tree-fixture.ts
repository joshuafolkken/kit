import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_location_environment } from '#scripts/git/git-location-environment'
import { test_network_guard } from '#scripts/test/test-network-guard'
import { execaSync } from 'execa'

// Real repositories for the working-tree reads, built with the real binary and a cleared environment
// (`test-repository-guard.ts`), so a fixture's commit never lands in the checkout the suite runs in.

const REAL_GIT = test_network_guard.GIT_BINARY ?? test_network_guard.GIT_SHIM_NAME
const IDENTITY = ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com']
const TEMP_PREFIX = 'josh-working-tree-'
const MANIFEST = 'package.json'
const COMMITTED_MANIFEST = '{ "name": "fixture" }\n'

const directories: Array<string> = []

function temporary_directory(): string {
	const directory = mkdtempSync(path.join(tmpdir(), TEMP_PREFIX))

	directories.push(directory)

	return directory
}

function remove_all(): void {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
}

function git(root: string, args: ReadonlyArray<string>): string {
	const result = execaSync(REAL_GIT, [...IDENTITY, ...args], {
		cwd: root,
		env: git_location_environment.location_free_environment(),
		extendEnv: true,
	})

	return result.stdout
}

function write(root: string, name: string, content: string): void {
	writeFileSync(path.join(root, name), content)
}

function repository(): string {
	const root = temporary_directory()

	git(root, ['init', '--initial-branch=main'])

	return root
}

// A repository with one commit holding `package.json` and a `.gitignore` that ignores `*.log`.
function committed_repository(manifest = COMMITTED_MANIFEST): string {
	const root = repository()

	write(root, MANIFEST, manifest)
	write(root, '.gitignore', '*.log\n')
	git(root, ['add', '--all'])
	git(root, ['commit', '--message', 'Initial commit'])

	return root
}

const working_tree_fixture = {
	MANIFEST,
	temporary_directory,
	remove_all,
	git,
	write,
	repository,
	committed_repository,
}

export { working_tree_fixture }
