import type { PartName, ThemeTimeline } from './run-board-theme-host-types'

// The confirmed theme demo's sample events (joshuafolkken/kit#8917), the texts as the board writes
// them: a notice, two progress lines and the frame's own last lane typing in. The demo's frames are
// drawn from these, so a theme that shows one of the texts reproduces them from here.

const NOTICE_ISSUE = '#8897'
const NOTICE_TEXT = `12:41 !! alert · ${NOTICE_ISSUE} Gate red — lint 2 errors`
// The progress line keeps its icon and types only its words.
const PROGRESS_LEAD = { icon: '> ', text: `${NOTICE_ISSUE} · Bash pnpm josh gate --changed` }
const PROGRESS_FOLLOW = { icon: 'OK', text: `${NOTICE_ISSUE} · Review passed — committing` }
const PROGRESS_TEXTS = [PROGRESS_LEAD, PROGRESS_FOLLOW]

// The demo's event keys: every effect in turn, the three events alone, idle, the opening, the ending.
type DemoKey = 'a' | 'i' | 'n' | 'o' | 'p' | 'r' | 'x'

// A demo event: its timeline, its name, how many ticks it plays before the normal display, and for
// the opening and the ending, which part it plays (its length is then the theme's).
interface DemoEvent extends ThemeTimeline {
	name: string
	last: number
	part?: PartName
}

// The two progress lines, starting on the ticks `starts` gives.
function progress_at(starts: { lead: number; follow: number }): ThemeTimeline['progress'] {
	return [
		{ start: starts.lead, ...PROGRESS_LEAD },
		{ start: starts.follow, ...PROGRESS_FOLLOW },
	]
}

// The demo's events for a board whose new lane's row reads `row_text`.
function demo_events(row_text: string): Record<DemoKey, DemoEvent> {
	const notice = [{ start: 10, text: NOTICE_TEXT }]
	const row = [{ start: 10, text: row_text }]

	return {
		a: {
			name: 'ALL',
			notice,
			progress: progress_at({ lead: 165, follow: 410 }),
			row: [{ start: 235, text: row_text }],
			last: 480,
		},
		n: { name: 'NOTICE', notice, progress: [], row: [], last: 225 },
		p: {
			name: 'PROGRESS',
			notice: [],
			progress: progress_at({ lead: 10, follow: 110 }),
			row: [],
			last: 220,
		},
		r: { name: 'ROW', notice: [], progress: [], row, last: 220 },
		i: { name: 'IDLE', notice: [], progress: [], row: [], last: 200 },
		o: { name: 'OPENING', notice: [], progress: [], row: [], last: 0, part: 'opening' },
		x: { name: 'ENDING', notice: [], progress: [], row: [], last: 0, part: 'ending' },
	}
}

const run_board_theme_host_sample = { NOTICE_ISSUE, NOTICE_TEXT, PROGRESS_TEXTS, demo_events }

export { run_board_theme_host_sample }
export type { DemoEvent, DemoKey }
