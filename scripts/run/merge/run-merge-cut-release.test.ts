import { lane_registry } from '#scripts/lane/lane-registry'
import { run_cut } from '#scripts/run/cut/run-cut'
import { run_cut_cli } from '#scripts/run/cut/run-cut-cli'
import { run_cut_cli_fixture } from '#scripts/run/cut/run-cut-cli-fixture'
import { expect, it, vi } from 'vitest'
import { run_merge_cut_release } from './run-merge-cut-release'

const { ISSUE, existing_cut, target, verdict } = run_cut_cli_fixture

run_cut_cli_fixture.install()

it('lets a collected adopter hand its saved resume point to another worker', async () => {
	existing_cut()
	await run_cut_cli.run(['--resume', ISSUE])
	const read = run_cut.read_cut(target())

	if (read.kind !== 'carried') throw new Error('Missing fixture cut')
	vi.spyOn(run_cut, 'lane_cut_sync').mockReturnValue({ target: target(), cut: read.cut })
	await run_merge_cut_release.release(ISSUE)
	await run_cut_cli.run(['--resume', ISSUE])
	expect(verdict()).toBe('resume')
})

it('keeps the cut when the lane cannot be found', async () => {
	existing_cut()
	await run_cut_cli.run(['--resume', ISSUE])
	vi.spyOn(lane_registry, 'find_open_lane').mockResolvedValue(undefined)
	await run_merge_cut_release.release(ISSUE)
	await run_cut_cli.run(['--resume', ISSUE])
	expect(verdict()).toBe('handed-off')
})
