import { expect, vi } from 'vitest'
import { run_board_motion_check_fixture, type MotionRun } from './run-board-motion-check-fixture'
import { run_board_motion_fixture, type Scene } from './run-board-motion-fixture'
import type { ThemeValue } from './run-board-theme-run'
import { run_board_theme_stress_fixture, type StressBoard } from './run-board-theme-stress-fixture'

// joshuafolkken/kit#8936: every theme and no theme, on one stress board, in every scene, replayed
// through the real frame loop on a terminal that takes just under one refresh a write; every frame keeps
// the motion check's rules. Each board of `MATRIX` has its own `run-board-motion-<columns>x<rows>.test.ts`
// so the shards and workers run the boards side by side; a theme added to `THEMES` joins every board.

const { MATRIX, THEMES } = run_board_theme_stress_fixture
const { SCENES, motion_run } = run_board_motion_fixture
const { motion_failures } = run_board_motion_check_fixture
// Just under the one refresh the frame loop may hold a frame back by.
const WRITE_MS = 15
const TIMEOUT_MS = 60_000
const VALUES: ReadonlyArray<ThemeValue> = [...THEMES, '']

function scenes_of(value: ThemeValue): ReadonlyArray<Scene> {
	return value === '' ? ['idle'] : SCENES
}

// The labels of the runs that wrote one frame or none: a replay the check would pass for having nothing
// to check.
function unwritten(runs: ReadonlyArray<MotionRun>): Array<string> {
	return runs
		.filter(({ frames }) => frames.filter(({ writes }) => writes.length > 0).length <= 1)
		.map(({ label }) => label)
}

// The `MATRIX` board `columns`×`rows`.
function board_of(columns: number, rows: number): StressBoard {
	const board = MATRIX.find((stress) => stress.columns === columns && stress.rows === rows)

	if (board === undefined) throw new Error(`no stress board ${String(columns)}x${String(rows)}`)

	return board
}

// Expects `value` on `board` to write frames in every scene, each keeping every motion rule.
async function expect_motion(board: StressBoard, value: ThemeValue): Promise<void> {
	vi.stubEnv('FORCE_COLOR', '3')

	try {
		const runs = await Promise.all(
			scenes_of(value).map(async (scene) => await motion_run({ value, board, scene }, WRITE_MS)),
		)

		expect(unwritten(runs)).toStrictEqual([])
		expect(runs.flatMap((run) => motion_failures(run))).toStrictEqual([])
	} finally {
		vi.unstubAllEnvs()
	}
}

const run_board_motion_board_fixture = { TIMEOUT_MS, VALUES, board_of, expect_motion }

export { run_board_motion_board_fixture }
