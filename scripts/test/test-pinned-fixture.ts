import { symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { git_fixture_workspace } from '#scripts/git/git-fixture-workspace'

// The git repository `josh test:pinned`'s run tests drive, modelled on joshuafolkken/kit#4102's round 1:
// `run()` gained a driver-flag output beside `result.token`, and the tests only covered the default
// path, so reverting that hunk to `result.token` left every test green. The hunk at line 3 is pinned —
// reverting it turns its test red — and the one at line 6 is not. A committed new module with no
// function adds no probe.

const DRIVER_FILE = 'driver.js'
const TEST_FILE = 'driver.test.ts'
const ADDED_FILE = 'added.js'
const NODE_MODULES = 'node_modules'
const PROJECT_NODE_MODULES = path.resolve(NODE_MODULES)
const PORCELAIN = '--porcelain'
const BASE_DRIVER = `// A driver.
export function label(code) {
	return code === 0 ? 'ok' : 'busy'
}

export function token_of(result) {
	return result.token
}
`
const CHANGED_DRIVER = `// The driver, whose comment edit no test can pin and the run drops.
export function label(code) {
	return code === 0 ? 'merged' : 'busy'
}

export function token_of(result, argv) {
	return argv.includes('--driver') ? String(result.code) : result.token
}
`
const DEFAULT_PATH_TEST = `import { expect, it } from 'vitest'
import { label, token_of } from './driver.js'

it('labels a merge', () => {
	expect(label(0)).toBe('merged')
})

it('reads the token on the default path', () => {
	expect(token_of({ token: 't', code: 0 }, [])).toBe('t')
})
`

async function git(arguments_: ReadonlyArray<string>): Promise<string> {
	return await git_fixture_workspace.git(process.cwd(), arguments_)
}

async function write(name: string, content: string): Promise<void> {
	await writeFile(path.join(process.cwd(), name), content)
}

async function link_node_modules(): Promise<void> {
	await symlink(PROJECT_NODE_MODULES, path.join(process.cwd(), NODE_MODULES), 'dir')
}

// main carries the base driver.
async function build_base(): Promise<void> {
	await git(['init', git_fixture_workspace.MAIN_BRANCH])
	await write('package.json', '{ "type": "module" }\n')
	await write('.gitignore', `${NODE_MODULES}\n`)
	await write(DRIVER_FILE, BASE_DRIVER)
	await git(['add', '.'])
	await git(['commit', '-m', 'base'])
}

// The `change` branch commits a new module no test reaches, and leaves the changed driver and its test
// uncommitted, so the run has to copy the working tree in.
async function build_change_branch(): Promise<void> {
	await build_base()
	await git(['switch', '-c', 'change'])
	await write(ADDED_FILE, 'export const ADDED = 1\n')
	await git(['add', ADDED_FILE])
	await git(['commit', '-m', 'add'])
	await write(DRIVER_FILE, CHANGED_DRIVER)
	await write(TEST_FILE, DEFAULT_PATH_TEST)
	await link_node_modules()
}

async function snapshot(): Promise<string> {
	const status = await git(['status', PORCELAIN])
	const trees = await git(['worktree', 'list', PORCELAIN])

	return `${status}\n${trees}`
}

const test_pinned_fixture = {
	CHANGED_DRIVER,
	DEFAULT_PATH_TEST,
	DRIVER_FILE,
	TEST_FILE,
	build_base,
	build_change_branch,
	git,
	link_node_modules,
	snapshot,
	write,
}

export { test_pinned_fixture }
