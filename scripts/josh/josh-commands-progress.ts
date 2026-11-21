import { OPTIONAL_ENV_FILE_FLAGS, type CommandEntry } from './josh-command-types'

// The run's progress, board and hand-off commands, split out of `josh-commands-run.ts` when each
// command's usage moved onto its entry (#4185). `RUN_COMMANDS` spreads this in at the same place, so
// the map keeps its order.

const BOARD_THEME = '--theme wargames'
const MATRIX_THEME = '--theme matrix'

const PROGRESS_COMMANDS: Record<string, CommandEntry> = {
	'run:progress': {
		script: 'scripts/run/progress/run-progress-main.ts',
		description: 'Report an unattended run’s progress once it has gone quiet for an interval',
		category: 'AI tools',
		reference: [
			'[--once | --wait] [--interval <minutes>] [--hours <hours>] [--repo <owner/repo>] [--output <path>] | --mark | --path',
			'automation',
			['files'],
		],
		usage: {
			examples: [
				{ arguments: '--output <path>' },
				{ arguments: '--once', note: 'five labelled lines now, whatever the clock says' },
				{ arguments: '--interval 20 --repo joshuafolkken/app-kit --hours 4' },
			],
			flags: [
				{
					names: ['--mark'],
					description:
						'record that a real report happened without printing a line (keeps the last line for `run:wake --list`).',
				},
				{
					names: ['--path'],
					description:
						'print the ambient heartbeat log\'s path and exit. Every heartbeat line is mirrored there, so `tail -F "$(pnpm josh run:progress --path)"` follows the run across a `backlogrun` session cut. Reads no run state, so it answers in a lane child too.',
				},
				{
					names: ['--interval <min>'],
					description:
						'silence interval (default 20; also `JOSH_PROGRESS_INTERVAL_MINUTES`, then `josh.progress_interval_minutes`).',
				},
				{
					names: ['--wait'],
					description:
						'start once in the background: as it starts it prints `progress-watcher.md` → "Progress while the run is quiet" once per session (a repeat names it in one line — `run:entry` has printed it first outside a lane child); each report then goes to the event stream and ambient log, never stdout; exits only on an arrival, `josh followup` ending the run, or `--hours`.',
				},
				{
					names: ['--hours <n>'],
					description: 'how long the watcher lives (default 8 with `--wait`, 1 otherwise).',
				},
				{ names: ['--repo <owner/name>'], description: 'scopes the read.' },
			],
		},
	},
	'run:board': {
		script: 'scripts/run/board/run-board-main.ts',
		// `--every` pushes its frame as a Telegram, so the credentials come from `.env` as for `run:carry`.
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		description: 'Draw a live board of the running backlogrun, redrawn every second',
		category: 'AI tools',
		reference: [
			`[--once | --chat [--fresh] | --every <minutes>] [--theme wargames|matrix] [--timing]`,
			'automation',
			['files', 'network'],
		],
		usage: {
			examples: [
				{ arguments: '', note: 'redraw until interrupted' },
				{ arguments: '--once', note: 'one frame, then exit' },
				{ arguments: '--chat', note: 'one frame for a chat, recorded as a progress report' },
				{
					arguments: '--chat --fresh',
					note: 'the same, read from scratch past the one-minute record',
				},
				{
					arguments: '--every 5',
					note: 'the --chat frame as a 📊 Progress Telegram every 5 minutes, until the run ends',
				},
				{ arguments: BOARD_THEME, note: 'cyan phosphor text and dashed rules' },
				{ arguments: MATRIX_THEME, note: 'green phosphor text and the TRACE gauge' },
				{ arguments: '--once --timing', note: 'one frame, then how long each phase of it took' },
			],
			flags: [
				{
					names: ['--chat'],
					description:
						'answers a `backlogrun`, `fullrun` or `halfrun` progress question: the frame `--once` draws, with only `🧠` on the machine line and no escapes; it records the report as `run:progress --mark` does.',
				},
				{
					names: ['--once', '--chat'],
					description:
						'each keeps the frame it drew for one minute, per checkout (`--once` per theme and per terminal or pipe); asked again within the minute, it writes that frame with a `recorded <N>s ago` line, read nothing. The age counts from when the read began.',
				},
				{
					names: ['--fresh'],
					description:
						'with `--chat`: reads from scratch past the record, and records what it drew; the `run:handoff-lanes` chain passes it right after a merge.',
				},
				{
					names: ['--every <minutes>'],
					description:
						'sends the `--chat` frame as a `📊 Progress` Telegram now and every `<minutes>` until the run ends — only when a person asks for it.',
				},
				{
					names: [BOARD_THEME],
					description:
						'draws uncolored text in phosphor cyan, rules as `-`; `JOSH_BOARD_THEME=wargames` sets it for every board (`backlogrun` too), `--theme` wins. A live board types its opening line, reveals its first frame block by block, left to right, 75 ms a line (a key skips it), then types each new issue row, `█` after it. Unknown names are refused; `--chat` and `--every` never take it.',
				},
				{
					names: [BOARD_THEME],
					description:
						'draws the board as a text terminal does: every icon as ASCII text of its width (`🚨` → `P1`, `🔨` → `BD`; one table, `run-board-theme-glyphs.ts`), the text in capitals (escapes and link URLs as written), and the spinner as `│ ╱ ─ ╲`; the columns line up as without it.',
				},
				{
					names: [BOARD_THEME],
					description:
						'drops an icon drawn beside the label that says what it marks (`CPU`, `QUEUED`), keeping one before a value (`CP 67%`): in a column’s rule its place is the rule, a heading reads `V -- NAME`, a row label moves into its place. One helper marks them (`run-board-label-pair.ts`); no theme and `--chat` draw as before.',
				},
				{
					names: [BOARD_THEME],
					description:
						'colors each icon’s text by the state it marks, then resumes the cyan: red fault (`FL`), amber caution (`JG`), magenta a person’s turn (`DC`), green done (`OK`), bold white in progress (`RN`), dim cyan idle (`ZZ`), the rest cyan (tones in the glyph table, colors in `run-board-theme-tones.ts`). Text inside a color already drawn keeps it; no escapes without color.',
				},
				{
					names: [BOARD_THEME],
					description:
						'ends the header’s first line on the alert level, `DEFCON 5 4 [3] 2 1`: the current level bracketed, green (5), amber (4, 3) or red (2, 1). The lowest level whose condition holds wins — 1 the run is stopped, out of its usage or failing its reads · 2 a person is asked to decide · 3 a `P1` waits while a lane is free · 4 more lanes run than the limit · 5 none of these.',
				},
				{
					names: [BOARD_THEME],
					description:
						'a live board runs a WOPR lamp panel on `24h`, `7d`, the blank line and usage’s first two provider rows (both or neither): past `NOW`, a `■` every other column to the throughput rule’s end, yellow, yellow, red, yellow, red, out in dimmed half yellow on every row (`run-board-lamps.ts`). None with no theme, `--once`, `--chat`, `--every`, no TTY or color, or under 8 lamps.',
				},
				{
					names: [BOARD_THEME],
					description:
						'bursts the lamp panel while a row types (the header’s third line, a section’s new row): the groups of four, each on its own period, all change every 80ms step, back to their periods from the step after typing ends (`run-board-spin.ts`).',
				},
				{
					names: [MATRIX_THEME],
					description:
						'draws as `--theme wargames` does, red and amber kept, with uncolored text in green phosphor (`green` without 24-bit color) and `TRACE ■■■■-` in place of `DEFCON`: one more `■` per level nearer 1, blinking red at 1 (`run-board-header-trace.ts`). No lamps or typed rows.',
				},
				{
					names: [MATRIX_THEME],
					description:
						'a live board types three lead lines in bright green, erasing each, then shows `KNOCK, KNOCK, JOSH.` at once (`run-board-theme-defs.ts`); a key skips it. None with no TTY or color.',
				},
				{
					names: ['--timing'],
					description:
						'after the `--once` frame, or once a live board leaves its screen, writes how long each phase of the first frame took (ms). `--chat` and `--every` ignore it.',
				},
				{
					names: ['--timing'],
					description:
						"on a live board, adds each kind of draw's max and median, then its main-thread stalls of 200 ms or more: their count, and the longest ten each with its length, the loop's stage that held it (`redraw` or `turn`) and the GC within it (`run-board-stall.ts`).",
				},
			],
		},
	},
	'run:pickup': {
		script: 'scripts/run/run-pickup-cli.ts',
		description:
			'Pick the lanes up after a manual cut: launch what the epics offer, then each liveness and the watcher line',
		category: 'AI tools',
		reference: ['[<epic>...]', 'automation', ['processes']],
		usage: {
			examples: [
				{ arguments: '', note: 'one line per lane, then the watcher line' },
				{
					arguments: '5800',
					note: 'first one line per child the epic offers: launched, refused or its verdict',
				},
			],
		},
	},
	'run:handoff-lanes': {
		script: 'scripts/run/handoff-lanes/run-handoff-lanes-cli.ts',
		description:
			'Chain a backlogrun hand-off: cost --cut, the lane reading, run:carry --cut, run:board --chat and run:report --handoff, answering under, cut, blocked or capped',
		category: 'AI tools',
		reference: ['', 'automation', ['processes', 'files', 'network']],
		usage: {
			examples: [
				{
					arguments: '',
					note: 'after each child’s merge; prints the verdict line, then its next action',
				},
			],
		},
	},
	'run:handoff': {
		script: 'scripts/run/handoff/run-handoff-cli.ts',
		description:
			'Hand a workflow keyword typed in a consultation session to a child on the role profile model',
		category: 'AI tools',
		reference: ['<keyword> [N|new ...] --brief-file <path>', 'automation', ['processes', 'files']],
		usage: {
			examples: [
				{
					arguments: 'kickoff new --brief-file .josh/tmp/brief.md',
					note: 'waits; prints its final message and URLs',
				},
				{
					arguments: 'fullrun <N> --brief-file .josh/tmp/brief.md',
					note: 'detached; a bare N is #N; check it with run:progress --once',
				},
				{
					arguments: 'backlogrun <E> --only',
					note: 'josh backlogrun with this session’s --agent',
				},
			],
		},
	},
	wait: {
		script: 'scripts/run/run-wait-main.ts',
		description:
			'Wait until a pid or process ends or a file exists, or one ship:wait chunk (done | pending)',
		category: 'AI tools',
		reference: [
			'[--pid <pid> | --process <pattern> | --file <path>]',
			'automation',
			['processes', 'files'],
		],
		is_read_only: true,
		usage: {
			examples: [
				{ arguments: '--process "run:chain <N>"', note: 'as `pgrep -f`' },
				{ arguments: '', note: 'a background subagent: the chunk' },
			],
		},
	},
}

export { PROGRESS_COMMANDS }
