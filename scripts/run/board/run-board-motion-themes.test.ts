import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_motion_check_fixture } from './run-board-motion-check-fixture'
import { run_board_motion_fixture, type Scene } from './run-board-motion-fixture'
import type { ThemeValue } from './run-board-theme-run'
import { run_board_theme_stress_fixture } from './run-board-theme-stress-fixture'

// joshuafolkken/kit#8936: every theme and no theme, on every stress board, in every scene, replayed
// through the real frame loop on a terminal that takes just under one refresh a write; every frame keeps
// the motion check's rules. A theme PR runs this before it opens (`.claude/skills/board-theme/SKILL.md`).

const { MATRIX, THEMES } = run_board_theme_stress_fixture
const { SCENES, motion_run } = run_board_motion_fixture
const { motion_failures } = run_board_motion_check_fixture
// Just under the one refresh the frame loop may hold a frame back by.
const WRITE_MS = 15
const TIMEOUT_MS = 60_000
const VALUES: ReadonlyArray<ThemeValue> = [...THEMES, '']
const CASES = VALUES.flatMap((value) => MATRIX.map((board) => ({ value, board })))

function scenes_of(value: ThemeValue): ReadonlyArray<Scene> {
	return value === '' ? ['idle'] : SCENES
}

describe('run_board_motion_check — every theme on every board', () => {
	beforeEach(() => {
		vi.stubEnv('FORCE_COLOR', '3')
	})

	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it.each(CASES)(
		'$value $board.columns x $board.rows keeps every motion rule in every scene',
		async ({ value, board }) => {
			const runs = await Promise.all(
				scenes_of(value).map(async (scene) => motion_run({ value, board, scene }, WRITE_MS)),
			)

			expect(runs.flatMap((run) => motion_failures(run))).toStrictEqual([])
		},
		TIMEOUT_MS,
	)
})
