import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prose_stale_read } from './prose-stale-read'
import { prose_stale_scan } from './prose-stale-scan'

// joshuafolkken/kit#7881, with real git: a changed value's old literal and a removed flag, searched in
// prose, and a removed flag live code still parses kept.

const TIMEOUT_MS = 30_000
const CODE = 'scripts/a.ts'
const DOC = 'docs/a.md'
const BASE = 'HEAD'
// Puts the value and its constant's words past the 80-character cut of a grep hit's excerpt.
const LONG_PREAMBLE =
	'A preamble long enough that what follows it sits well past the excerpt cut, so'

const { git, MAIN_BRANCH } = git_fixture_workspace

const fixture: FixtureWorkspace & { root: string } = {
	workspace: '',
	root: '',
	previous_cwd: '',
	restore_environment: undefined,
}

async function write(file: string, content: string): Promise<void> {
	await mkdir(path.dirname(path.join(fixture.root, file)), { recursive: true })
	await writeFile(path.join(fixture.root, file), content)
}

async function commit_base(): Promise<void> {
	await write(CODE, "export const FILE_GUIDE = 8\nconst DAYS = args.includes('--period')\n")
	await write(
		'scripts/b.ts',
		"// --shared is parsed below\nconst SHARED = args.includes('--shared')\n",
	)
	await write(CODE.replace('a.ts', 'c.ts'), "const FAST = args.includes('--shared')\n")
	await write(
		DOC,
		`${LONG_PREAMBLE} the file guide is 8 changed files.\nRun \`josh x:y --period 7 --shared\`.\nStep 8.\n`,
	)
	await git(fixture.root, ['add', '--all'])
	await git(fixture.root, ['commit', '--no-verify', '-m', 'base'])
}

beforeEach(async () => {
	const opened = git_fixture_workspace.open_workspace('kit-prose-stale-values-')

	fixture.workspace = opened.workspace
	fixture.previous_cwd = opened.previous_cwd
	fixture.restore_environment = opened.restore_environment
	fixture.root = path.join(fixture.workspace, 'repository')

	await git(fixture.workspace, ['init', MAIN_BRANCH, 'repository'])
	await commit_base()
}, TIMEOUT_MS)

afterEach(async () => {
	await git_fixture_workspace.close_workspace(fixture)
})

async function report_text(): Promise<string> {
	const hunks = await prose_stale_read.read_hunks(fixture.root, BASE)

	return prose_stale_scan.report(await prose_stale_read.references(fixture.root, hunks)).text
}

describe('prose_stale_read.references (values and flags)', () => {
	it(
		'reports the old value and the removed flag, and keeps a flag other code still parses',
		async () => {
			await write(CODE, "export const FILE_GUIDE = 10\nconst DAYS = args.includes('--days')\n")
			await write(CODE.replace('a.ts', 'c.ts'), 'const FAST = false\n')

			await expect(report_text()).resolves.toBe(
				[`${DOC}:2 flag --period`, `${DOC}:1 value 8 (FILE_GUIDE now 10)`].join('\n'),
			)
		},
		TIMEOUT_MS,
	)
})
