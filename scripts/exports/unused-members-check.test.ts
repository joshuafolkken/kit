import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buffered_process } from '#scripts/lib/buffered-process'
import { NOTHING_TO_CHECK_MARKER, SKIP_MARKER } from '#scripts/test/skip-marker'
import { KIT_PACKAGE_NAME } from '#scripts/version/kit-descriptor'
import { unused_members_fixture } from '#tools/exports/unused-members-fixture'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { unused_members_check } from './unused-members-check'

const { create_project, with_reader, READ_KEPT } = unused_members_fixture
const PASS_EXIT_CODE = 0
const FAIL_EXIT_CODE = 1
const DROPPED_LINE = 'library.ts:3  library.dropped'
const READ_ALL = 'export const value = library.kept() + library.dropped()'
const NO_UNUSED = 'no unused namespace member'
const LIBRARY = 'library.ts'
const CLI_BUNDLE = fileURLToPath(
	new URL('../../dist/commands/unused-members-cli.js', import.meta.url),
)

// A project that consumes kit, where the check is out of scope.
function consumer_root(): string {
	const root = create_project(with_reader(READ_KEPT))
	const manifest = { name: 'consumer', devDependencies: { [KIT_PACKAGE_NAME]: '1.0.0' } }

	writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest))

	return root
}

function capture(): { info: Array<string>; error: Array<string> } {
	const info: Array<string> = []
	const error: Array<string> = []

	vi.spyOn(console, 'info').mockImplementation((message: string) => {
		info.push(message)
	})
	vi.spyOn(console, 'error').mockImplementation((message: string) => {
		error.push(message)
	})

	return { info, error }
}

afterEach(() => vi.restoreAllMocks())

describe('unused_members_check.run_unused_members', () => {
	it('passes and says so when every member is read', async () => {
		const output = capture()
		const exit_code = await unused_members_check.run_unused_members(
			create_project(with_reader(READ_ALL)),
		)

		expect(exit_code).toBe(PASS_EXIT_CODE)
		expect(output.info.join('\n')).toContain(NO_UNUSED)
	})

	it('fails and names each unused member with its location', async () => {
		const output = capture()
		const exit_code = await unused_members_check.run_unused_members(
			create_project(with_reader(READ_KEPT)),
		)
		const text = output.error.join('\n')

		expect(exit_code).toBe(FAIL_EXIT_CODE)
		expect(text).toContain('1 namespace member(s) nothing reads')
		expect(text).toContain(DROPPED_LINE)
	})

	it('skips a consumer project without scanning it', async () => {
		const output = capture()

		expect(await unused_members_check.run_unused_members(consumer_root())).toBe(PASS_EXIT_CODE)
		expect(output.info).toStrictEqual([unused_members_check.CONSUMER_NOTICE])
		expect(output.error).toStrictEqual([])
	})
})

describe('unused_members_check.run_unused_members — narrowed to files', () => {
	it('names only the unused members of namespaces the given files declare or import', async () => {
		const output = capture()
		const root = create_project([...with_reader(READ_KEPT), ['other.ts', 'export const a = 1']])
		const exits = await Promise.all(
			[LIBRARY, 'reader.ts', 'other.ts'].map(
				async (file) =>
					await unused_members_check.run_unused_members(root, [path.join(root, file)]),
			),
		)

		expect(exits).toStrictEqual([FAIL_EXIT_CODE, FAIL_EXIT_CODE, PASS_EXIT_CODE])
		expect(output.error.join('\n')).toContain(DROPPED_LINE)
	})
})

// joshuafolkken/kit#7829: the child `josh lint:related` starts beside its lint.
describe('unused_members_check.spawn_unused_members', () => {
	it('answers a consumer with the notice without a child', async () => {
		const spawn = vi.spyOn(buffered_process, 'run_buffered_direct')

		await expect(
			unused_members_check.spawn_unused_members(consumer_root(), []),
		).resolves.toStrictEqual({
			exit_code: PASS_EXIT_CODE,
			output: unused_members_check.CONSUMER_NOTICE,
		})
		expect(spawn).not.toHaveBeenCalled()
	})

	it('answers an empty narrowed list with the empty report without a child', async () => {
		const spawn = vi.spyOn(buffered_process, 'run_buffered_direct')
		const run = await unused_members_check.spawn_unused_members(
			create_project(with_reader(READ_KEPT)),
			[],
		)

		expect(run.exit_code).toBe(PASS_EXIT_CODE)
		expect(run.output).toContain(NO_UNUSED)
		expect(spawn).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#8203: the built bundle, so the child does not transform the CLI on every start.
describe('unused_members_check.spawn_unused_members — the child launch', () => {
	it('runs the CLI bundle of this package under node with the files, in a root that is not kit', async () => {
		const spawn = vi
			.spyOn(buffered_process, 'run_buffered_launch')
			.mockResolvedValue({ output: DROPPED_LINE, exit_code: undefined, elapsed_ms: 0 })
		const root = create_project(with_reader(READ_KEPT))
		const run = await unused_members_check.spawn_unused_members(root, [LIBRARY])

		expect(run).toStrictEqual({ exit_code: FAIL_EXIT_CODE, output: DROPPED_LINE })
		expect(spawn).toHaveBeenCalledWith(
			{ file: process.execPath, args: [CLI_BUNDLE, LIBRARY] },
			{ cwd: root },
		)
	})

	it('scans the whole program with no file argument when given no list', async () => {
		const spawn = vi
			.spyOn(buffered_process, 'run_buffered_launch')
			.mockResolvedValue({ output: NO_UNUSED, exit_code: 0, elapsed_ms: 0 })
		const root = create_project(with_reader(READ_ALL))

		await unused_members_check.spawn_unused_members(root)

		expect(spawn).toHaveBeenCalledWith(
			{ file: process.execPath, args: [CLI_BUNDLE] },
			{ cwd: root },
		)
	})
})

describe('unused_members_check.CONSUMER_NOTICE', () => {
	it('says a consumer is out of scope without the skip marker that withholds the green record', () => {
		expect(unused_members_check.CONSUMER_NOTICE).toContain('nothing to check in a consumer project')
		expect(unused_members_check.CONSUMER_NOTICE).not.toContain(SKIP_MARKER)
	})

	// The gate's verdict reads this marker to tell a check that looked at nothing from one that ran.
	it('carries the marker the gate verdict reads a check with nothing to check by', () => {
		expect(unused_members_check.CONSUMER_NOTICE).toContain(NOTHING_TO_CHECK_MARKER)
	})
})
