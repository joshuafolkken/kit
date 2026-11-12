import { mkdirSync, readdirSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import { josh_cli_fixture } from '#scripts/josh/josh-cli-fixture'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { BUNDLED_COMMAND_DIRECTORY } from '#scripts/josh/josh-in-process'
import { temporary_directory } from '#tools/test/temporary-directory'
import { execa } from 'execa'
import { beforeAll, describe, expect, it } from 'vitest'
import { build_bin } from './build-bin'
import { build_commands } from './build-commands'
import { DISPATCH_TEST_PREFIX } from './distribution-scratch-fixture'
import { SCRIPTS_DIR } from './import-closure-fixture'

// A pre-built command answers the same through a built `dist/josh.js` as through the source
// dispatcher, so pre-building changes only the start-up cost (joshuafolkken/kit#4186, #7013).
//
// The built package is a private root under `dist/`: its top-level entries are links to this
// checkout's, so the bundles resolve the same documents, and node still finds `node_modules` above
// it. A `pnpm build` running beside this suite never has its `dist/josh.js` or `dist/commands`
// replaced.
const BUILD_TIMEOUT = 60_000
const RUN_TIMEOUT = 30_000
const PACKAGE_DIR = path.join(SCRIPTS_DIR, '..')
const UNLINKED: ReadonlySet<string> = new Set(['.git', 'dist', 'node_modules'])

// Network-free invocations, a usage refusal where any other answer would reach GitHub.
// `run:board` sits three directories deep and shares chunks with other commands, so its answer
// shows that a chunked module still finds the package from its source location.
const NOT_AN_ISSUE = 'not-a-number'
const INVOCATIONS: ReadonlyArray<ReadonlyArray<string>> = [
	['completion', '--names'],
	['doc:section', 'CLAUDE.md', 'Communication'],
	['doc:read', 'CLAUDE.md'],
	['read:set', 'backlogrun'],
	['run:prep', NOT_AN_ISSUE],
	['run:step', NOT_AN_ISSUE],
	['run:board', '--help'],
	['run:chain', NOT_AN_ISSUE],
	['ship:wait', NOT_AN_ISSUE],
	['lane:stats', NOT_AN_ISSUE],
]

interface Answer {
	status: number | undefined
	stdout: string
	stderr: string
}

mkdirSync(path.join(PACKAGE_DIR, 'dist'), { recursive: true })
const package_root = temporary_directory('suite')(
	path.join(PACKAGE_DIR, 'dist', DISPATCH_TEST_PREFIX),
)
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

async function answer(command: string, arguments_: ReadonlyArray<string>): Promise<Answer> {
	const result = await execa(command, [...arguments_], {
		cwd: PACKAGE_DIR,
		reject: false,
		stripFinalNewline: false,
	})

	return { status: result.exitCode, stdout: result.stdout, stderr: result.stderr }
}

async function source_answer(arguments_: ReadonlyArray<string>): Promise<Answer> {
	const { executable, leading_arguments } = josh_cli_fixture.SOURCE_JOSH

	return await answer(executable, [...leading_arguments, ...arguments_])
}

describe('bundled commands through dist/josh.js', () => {
	it('names only script commands', () => {
		const named = INVOCATIONS.map(([command = '']) => COMMAND_MAP[command]?.script)

		expect(named).not.toContain(undefined)
	})

	// The two sides share no state, so they start together: one start-up each test, not two.
	it.each(INVOCATIONS)(
		'%s answers the same as the source dispatcher',
		async (...invocation) => {
			const [built, source] = await Promise.all([
				answer('node', [built_josh, ...invocation]),
				source_answer(invocation),
			])

			expect(built).toStrictEqual(source)
		},
		RUN_TIMEOUT,
	)
})
