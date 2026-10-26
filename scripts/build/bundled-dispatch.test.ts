import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import { josh_cli_fixture } from '#scripts/josh/josh-cli-fixture'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { BUNDLED_COMMAND_DIRECTORY } from '#scripts/josh/josh-in-process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build_bin } from './build-bin'
import { build_commands } from './build-commands'
import { DISPATCH_TEST_PREFIX } from './distribution-scratch-fixture'
import { SCRIPTS_DIR } from './import-closure-fixture'

// Each `is_bundled` command answers the same through a built `dist/josh.js` as through the source
// dispatcher, so pre-building it changes only the start-up cost (joshuafolkken/kit#4186).
//
// The built package is a private root under `dist/`: its top-level entries are links to this
// checkout's, so the bundles resolve the same documents, and node still finds `node_modules` above
// it. A `pnpm build` running beside this suite never has its `dist/josh.js` or `dist/commands`
// replaced.
const BUILD_TIMEOUT = 60_000
const RUN_TIMEOUT = 30_000
const PACKAGE_DIR = path.join(SCRIPTS_DIR, '..')
const UNLINKED: ReadonlySet<string> = new Set(['.git', 'dist', 'node_modules'])

// One network-free invocation per bundled command; a usage refusal where any other answer would
// reach GitHub.
const NOT_AN_ISSUE = 'not-a-number'
const INVOCATIONS: ReadonlyArray<ReadonlyArray<string>> = [
	['doc:section', 'CLAUDE.md', 'Communication'],
	['doc:read', 'CLAUDE.md'],
	['read:set', 'backlogrun'],
	['run:prep', NOT_AN_ISSUE],
	['run:step', NOT_AN_ISSUE],
]

interface Answer {
	status: number | null
	stdout: string
	stderr: string
}

mkdirSync(path.join(PACKAGE_DIR, 'dist'), { recursive: true })
const package_root = mkdtempSync(path.join(PACKAGE_DIR, 'dist', DISPATCH_TEST_PREFIX))
const built_josh = path.join(package_root, 'dist', 'josh.js')

function link_package(): void {
	for (const name of readdirSync(PACKAGE_DIR)) {
		if (!UNLINKED.has(name)) {
			symlinkSync(path.join(PACKAGE_DIR, name), path.join(package_root, name))
		}
	}
}

beforeAll(async () => {
	link_package()
	await build_bin(built_josh)
	await build_commands(path.join(package_root, BUNDLED_COMMAND_DIRECTORY))
}, BUILD_TIMEOUT)

afterAll(() => {
	rmSync(package_root, { recursive: true, force: true })
})

function answer(command: string, arguments_: ReadonlyArray<string>): Answer {
	const result = spawnSync(command, arguments_, { cwd: PACKAGE_DIR, encoding: 'utf8' })

	return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function source_answer(arguments_: ReadonlyArray<string>): Answer {
	const { executable, leading_arguments } = josh_cli_fixture.SOURCE_JOSH

	return answer(executable, [...leading_arguments, ...arguments_])
}

const BUNDLED_COMMANDS = Object.keys(COMMAND_MAP).filter(
	(name) => COMMAND_MAP[name]?.is_bundled === true,
)

describe('bundled commands through dist/josh.js', () => {
	it('names an invocation for every bundled command', () => {
		const named = new Set(INVOCATIONS.map(([command]) => command))

		expect(named).toStrictEqual(new Set(BUNDLED_COMMANDS))
	})

	it.each(INVOCATIONS)(
		'%s answers the same as the source dispatcher',
		(...invocation) => {
			expect(answer('node', [built_josh, ...invocation])).toStrictEqual(source_answer(invocation))
		},
		RUN_TIMEOUT,
	)
})
