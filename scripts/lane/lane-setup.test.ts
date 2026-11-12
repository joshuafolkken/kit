import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { buffered_process, type BufferedProcessResult } from '#scripts/lib/buffered-process'
import { PACKAGE_JSON } from '#scripts/lib/package-manifest'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LaneInfo } from './lane-registry'
import { lane_setup, MAIN_CHECKOUT_KEY, SHELL_ARGUMENTS } from './lane-setup'

const make_directory = temporary_directory()

// joshuafolkken/kit#7203: what is asserted is what this module asks `buffered_process` for and how it
// reads the answer; the spawning itself is `buffered-process.test.ts`'s. The manifest is a real file
// in a real temp tree, because reading it is half of what this module does.

vi.mock('#scripts/lib/buffered-process', () => ({
	buffered_process: {
		child_environment: (): NodeJS.ProcessEnv => ({ FORCE_COLOR: '1' }),
		is_process_failed: (result: Pick<BufferedProcessResult, 'exit_code'>): boolean =>
			result.exit_code !== 0,
		run_buffered_process: vi.fn(),
	},
}))

const mocked_run = vi.mocked(buffered_process.run_buffered_process)

const ISSUE = '7203'
const MAIN_CHECKOUT = '/work/project'
const SETUP_COMMAND = 'cp -c -R "$JOSH_MAIN_CHECKOUT/target" target'
const FAILURE_OUTPUT = 'cp: target: No such file or directory'
const ELAPSED_MS = 1200

const lane = { info: undefined as LaneInfo | undefined }

function lane_info(directory: string): LaneInfo {
	return {
		issue: ISSUE,
		branch: `${ISSUE}-lane`,
		directory,
		seat: 1,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		is_stranded: false,
	}
}

function current_lane(): LaneInfo {
	if (lane.info === undefined) throw new Error('no lane')

	return lane.info
}

function write_manifest(manifest: unknown): void {
	writeFileSync(path.join(current_lane().directory, PACKAGE_JSON), JSON.stringify(manifest))
}

function process_answers(exit_code: number, output: string): void {
	mocked_run.mockResolvedValue({ output, exit_code, elapsed_ms: ELAPSED_MS })
}

beforeEach(() => {
	lane.info = lane_info(make_directory('lane-setup-test-'))
	mocked_run.mockReset()
	process_answers(0, '')
})

describe('a project that names josh.lane.setup', () => {
	it('runs the command in the lane with the main checkout in its environment', async () => {
		write_manifest({ josh: { lane: { setup: SETUP_COMMAND } } })
		await lane_setup.run_setup(current_lane(), MAIN_CHECKOUT)

		expect(mocked_run).toHaveBeenCalledWith([...SHELL_ARGUMENTS, SETUP_COMMAND], {
			cwd: current_lane().directory,
			environment: { FORCE_COLOR: '1', [MAIN_CHECKOUT_KEY]: MAIN_CHECKOUT },
		})
	})

	it('fails the open with the command output and both ways out', async () => {
		write_manifest({ josh: { lane: { setup: SETUP_COMMAND } } })
		process_answers(1, FAILURE_OUTPUT)
		const failure = lane_setup.run_setup(current_lane(), MAIN_CHECKOUT)

		await expect(failure).rejects.toThrow(FAILURE_OUTPUT)
		await expect(failure).rejects.toThrow(`pnpm josh lane:close ${ISSUE}`)
	})
})

describe('a project without josh.lane.setup', () => {
	it.each([
		['no josh key', {}],
		['no lane key', { josh: { review_gate: 'local' } }],
	])('runs nothing for %s', async (_label, manifest) => {
		write_manifest(manifest)
		await lane_setup.run_setup(current_lane(), MAIN_CHECKOUT)

		expect(mocked_run).not.toHaveBeenCalled()
	})

	it('runs nothing for a lane with no package.json', async () => {
		await lane_setup.run_setup(current_lane(), MAIN_CHECKOUT)

		expect(mocked_run).not.toHaveBeenCalled()
	})
})
