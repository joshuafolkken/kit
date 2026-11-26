import { vi } from 'vitest'
import type { TerminalSize } from './run-board-fit'
import type { Harness } from './run-board-fixture'
import type { Quotas } from './run-board-quota-read'
import type { GithubRateLimit } from './run-board-render-quota-github'
import type { BoardPorts, BoardState } from './run-board-state'
import type { UsageMark } from './run-board-usage'
import { run_board_usage_board } from './run-board-usage-board'

// The reads a live board's lamp panel is laid out by (joshuafolkken/kit#8917), for the suites that draw
// a theme: two providers' usage and GitHub's allowance — the usage section's three rows, so the panel
// runs its seven rows — and the lanes' usage, whose cells run the rules out to a live board's width,
// on the real board's 200×50 pane. With them the panel is one a theme is drawn on
// (`run-board-theme-layout.ts`: six rows and forty columns at the least); without, the board is plain.

const PANE: TerminalSize = { rows: 50, columns: 200 }
const HOUR_MS = 3_600_000
const QUOTAS: Quotas = {
	claude: { windows: [{ minutes: 300, used_percent: 42, resets_ms: HOUR_MS }], taken_ms: 0 },
	codex: { windows: [{ minutes: 300, used_percent: 17, resets_ms: HOUR_MS }], taken_ms: 0 },
}
const RATE_LIMIT: GithubRateLimit = {
	core: { remaining: 4321, limit: 5000, reset_ms: HOUR_MS },
	graphql: undefined,
}
const USAGE: UsageMark = {
	at_ms: 0,
	processes: new Map(),
	lanes: new Map(),
	names: new Map(),
	parents: new Map(),
	unread: new Set(),
	folded: new Set(),
	cores: 1,
	total_bytes: 1000,
}

// The same reads as board state, for a suite that draws a frame from its state.
const PANEL_STATE: Pick<BoardState, 'quotas' | 'rate_limit' | 'usages'> = {
	quotas: QUOTAS,
	rate_limit: RATE_LIMIT,
	usages: run_board_usage_board.board_usage_of(undefined, USAGE, undefined),
}

// The harness's ports reading the panel's reads, on the real board's pane.
function paneled(board: Harness): BoardPorts {
	board.gathering.read_quotas = vi.fn(async () => QUOTAS)
	board.read_usage.mockResolvedValue(USAGE)

	return { ...board.ports, read_rate_limit: async () => RATE_LIMIT, size: () => PANE }
}

const run_board_panel_fixture = { PANE, PANEL_STATE, paneled }

export { run_board_panel_fixture }
