import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { run_park } from '#scripts/run/park/run-park'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_hold } from './run-hold'
import { run_hold_cli } from './run-hold-cli'

const make_directory = temporary_directory('suite')

const { directories, repository } = vi.hoisted(() => ({
	directories: vi.fn(),
	repository: vi.fn(),
}))

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: directories },
}))
vi.mock('#scripts/git/git-common-directory', () => ({
	git_common_directory: { repository },
}))
vi.mock('#scripts/lane/lane-handoff', () => ({
	lane_handoff: { is_handed_off: vi.fn(() => false) },
}))
vi.mock('#scripts/run/run-label', () => ({ run_label: { unmark: vi.fn() } }))

const ISSUE = '6404'
const SUCCESS = 0
const FAILURE = 1
const ENTRY = path.resolve('scripts/run/hold/run-hold-main.ts')
const ORIGINAL_DIRECTORY = process.cwd()
const SCRATCH = make_directory('run-release-child-')
const LANE = path.join(SCRATCH, '.kit-lanes', ISSUE)
const GIT_DIRECTORY = path.join(SCRATCH, '.git')
const errors: Array<string> = []

beforeEach(() => {
	mkdirSync(LANE, { recursive: true })
	process.chdir(LANE)
	vi.stubEnv(lane_child_marker.KEY, ISSUE)
	directories.mockResolvedValue([GIT_DIRECTORY, GIT_DIRECTORY])
	repository.mockReturnValue(GIT_DIRECTORY)
	run_hold.create_hold(run_hold.hold_path(GIT_DIRECTORY), ISSUE, new Date())
	errors.length = 0
	vi.spyOn(console, 'error').mockImplementation((line: string) => {
		errors.push(line)
	})
})

afterEach(() => {
	run_park.clear(ISSUE, LANE)
	rmSync(run_hold.hold_path(GIT_DIRECTORY), { force: true })
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
	process.chdir(ORIGINAL_DIRECTORY)
})

describe('direct run:release from a dispatched lane child', () => {
	it.each([
		['bare', ['--release']],
		['numbered', ['--release', ISSUE]],
	])('refuses %s release before removing the hold', async (_name, argv) => {
		expect(await main_entry_fixture.run_entry(ENTRY, argv)).toBe(FAILURE)
		expect(errors.join('\n')).toContain(`pnpm josh run:park ${ISSUE} --body-file`)
		expect(run_hold.read_hold(run_hold.hold_path(GIT_DIRECTORY)).kind).toBe('held')
	})

	it('releases after run:park has recorded the park', async () => {
		expect(run_park.record(ISSUE, LANE)).toBe(true)
		expect(await main_entry_fixture.run_entry(ENTRY, ['--release', ISSUE])).toBe(SUCCESS)
		expect(run_hold.read_hold(run_hold.hold_path(GIT_DIRECTORY)).kind).toBe('free')
	})

	it('keeps forced release available', async () => {
		expect(await main_entry_fixture.run_entry(ENTRY, ['--release', '--force'])).toBe(SUCCESS)
		expect(run_hold.read_hold(run_hold.hold_path(GIT_DIRECTORY)).kind).toBe('free')
	})

	it('releases from a session outside the dispatched lane', async () => {
		process.chdir(SCRATCH)
		expect(await main_entry_fixture.run_entry(ENTRY, ['--release', ISSUE])).toBe(SUCCESS)
		expect(run_hold.read_hold(run_hold.hold_path(GIT_DIRECTORY)).kind).toBe('free')
	})

	it('keeps the internal release available before a park', async () => {
		expect(await run_hold_cli.run(['--release', ISSUE])).toBe(SUCCESS)
		expect(run_hold.read_hold(run_hold.hold_path(GIT_DIRECTORY)).kind).toBe('free')
	})
})
