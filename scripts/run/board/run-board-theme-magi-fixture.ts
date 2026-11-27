import { run_board_theme_demo_fixture } from './run-board-theme-demo-fixture'
import { run_board_theme_magi } from './run-board-theme-magi'
import type { MagiKit } from './run-board-theme-magi-data'

// The MAGI theme's unit tests' shared pieces (joshuafolkken/kit#8917): the demo's board pieces of
// `run-board-theme-demo-fixture.ts` and the theme's kit.

const { HOST, fresh_grid, row_text, state_at } = run_board_theme_demo_fixture

const KIT: MagiKit = run_board_theme_magi.kit_of(HOST.api)

const run_board_theme_magi_fixture = { HOST, KIT, fresh_grid, row_text, state_at }

export { run_board_theme_magi_fixture }
