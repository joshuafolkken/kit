import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { platform_temporary } from '#scripts/josh/platform-temporary'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_carry } from './run-carry'
import { run_carry_cli } from './run-carry-cli'
import { run_carry_cli_fixture } from './run-carry-cli-fixture'
import { run_carry_ended } from './run-carry-ended'

// joshuafolkken/kit#3458: live evidence for `run:carry` once rewrote and then ended the record of the
// run that was actually going. `JOSH_TEMP_ROOT` moves every record the run keeps — they are all
// `stamp_path`s — so a process started with it set touches nothing of the live run, whatever
// directory it runs from. The root is read once, on import, so the redirected process is a fresh
// module graph here, as it is a fresh process in the evidence procedure.

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: vi.fn(), status: vi.fn() },
}))
vi.mock('#scripts/josh/josh-run', () => ({
	josh_command: { josh_run: vi.fn().mockResolvedValue({ code: 0, out: '' }) },
}))
vi.mock('./run-carry-stash', () => ({
	run_carry_stash: { report_orphans: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('#scripts/run/run-stop-notify', () => ({
	run_stop_notify: { plan: vi.fn(), announce: vi.fn() },
}))
vi.mock('#scripts/run/merge/run-merge-collect', () => ({
	run_merge_collect: { collect_merged: vi.fn().mockResolvedValue(undefined) },
}))

const { git_command } = await import('#scripts/git/git-command')
const git_directories = vi.mocked(git_command.git_directories)

const scratch = mkdtempSync(path.join(tmpdir(), 'run-carry-state-root-test-'))
const evidence_root = path.join(scratch, 'evidence')
const REPOSITORY = path.join(scratch, 'repository.git')
const LIVE_INVOCATION = 'backlogrun #3431 --only'
const EVIDENCE_INVOCATION = 'backlogrun --max 5'
const OK = 0

interface RedirectedRun {
	cli: typeof run_carry_cli
	ended: typeof run_carry_ended
}

async function redirected_run(): Promise<RedirectedRun> {
	mkdirSync(evidence_root)
	vi.resetModules()
	vi.stubEnv(platform_temporary.TEMP_ROOT_KEY, evidence_root)
	const { cost_cli } = await import('#scripts/cost-runtime/cost-cli')
	const { run_carry_cli: cli } = await import('./run-carry-cli')
	const { run_carry_ended: ended } = await import('./run-carry-ended')

	vi.spyOn(cost_cli, 'session_verdict').mockReturnValue('unmeasurable')

	return { cli, ended }
}

beforeEach(() => {
	run_carry_cli_fixture.hold_verdict()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	git_directories.mockResolvedValue([REPOSITORY, REPOSITORY])
})

afterEach(() => {
	vi.unstubAllEnvs()
	run_carry.end_carry(run_carry.carry_path(REPOSITORY))
	rmSync(evidence_root, { recursive: true, force: true })
})

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true })
})

describe('run:carry under JOSH_TEMP_ROOT — the live run is out of reach', () => {
	it('begins and ends its own record while the live run’s record stays as it was', async () => {
		await run_carry_cli.run(['--begin', LIVE_INVOCATION])
		const live = run_carry.read_carry(run_carry.carry_path(REPOSITORY))
		const { cli, ended } = await redirected_run()

		expect(await cli.run(['--begin', EVIDENCE_INVOCATION])).toBe(OK)
		expect(await cli.run(['--end'])).toBe(OK)

		expect(run_carry.read_carry(run_carry.carry_path(REPOSITORY))).toStrictEqual(live)
		expect(ended.ended_path(REPOSITORY).startsWith(evidence_root)).toBe(true)
		expect(ended.read_ended(ended.ended_path(REPOSITORY))?.invocation).toBe(EVIDENCE_INVOCATION)
		expect(run_carry_ended.read_ended(run_carry_ended.ended_path(REPOSITORY))).toBeUndefined()
	})
})
