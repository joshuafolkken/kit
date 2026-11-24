import { OPTIONAL_ENV_FILE_FLAGS, type CommandEntry } from './josh-command-types'

// The run's progress, board and hand-off commands, split out of `josh-commands-run.ts` when each
// command's usage moved onto its entry (#4185). `RUN_COMMANDS` spreads this in at the same place, so
// the map keeps its order.

const BOARD_THEME = '--theme wargames'
const MATRIX_THEME = '--theme matrix'
const BTTF_THEME = '--theme bttf'

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
			`[--once | --chat [--fresh] | --every <minutes> | --frame [<frame flags>]] [--theme wargames|matrix|bttf] [--icons emoji|letters|shapes] [--timing]`,
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
				{ arguments: BTTF_THEME, note: 'grey text, slate rules, header in time-circuit colors' },
				{ arguments: '--icons letters', note: 'every icon as two-letter capitals' },
				{ arguments: '--once --timing', note: 'one frame, then how long each phase of it took' },
				{ arguments: '--frame --mute', note: 'one live frame, muted, at a fixed size' },
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
						'draws the board as a text terminal does: the text in capitals (escapes and link URLs as written) and the spinner as `│ ╱ ─ ╲`; each icon as `--icons` draws it, `shapes` unless set; the columns line up as without it.',
				},
				{
					names: ['--icons <emoji|letters|shapes>'],
					description:
						'`emoji` as drawn; `letters` as ASCII of their width (`🚨` → `P1`; `run-board-theme-glyphs.ts`); `shapes` a state as a shape where it has one (`🔄` → `>>`, `🔗` → `<-`, `⏸` → `║`). Unset: `emoji` with no theme, else `shapes`. No theme: tone color only. `JOSH_BOARD_ICONS` sets it, `--icons` wins; unknown names refused; not for `--chat` / `--every`.',
				},
				{
					names: [BOARD_THEME],
					description:
						'drops an icon drawn beside the label that says what it marks (`CPU`, `QUEUED`), keeping one before a value (`CP 67%`): in a column’s rule its place is the rule, a heading reads `V -- NAME`, a row label moves into its place. One helper marks them (`run-board-label-pair.ts`); no theme and `--chat` draw as before.',
				},
				{
					names: [BOARD_THEME],
					description:
						'colors each icon’s text by the state it marks, then resumes the cyan: red fault (`FL`), amber caution (`JG`), magenta a person’s turn (`\\O`), green done (`OK`), bold white in progress (`>>`), dim cyan idle (`ZZ`), the rest cyan (tones in the glyph table, colors in `run-board-theme-tones.ts`). Text inside a color already drawn keeps it; no escapes without color.',
				},
				{
					names: [BOARD_THEME],
					description:
						'ends the `📈 throughput` rule on the alert level, `DEFCON 5 4 [3] 2 1`: the current level bracketed, green (5), amber (4, 3) or red (2, 1). The lowest level whose condition holds wins — 1 the run is stopped, out of its usage or failing its reads · 2 a person is asked to decide · 3 a `P1` waits while a lane is free · 4 more lanes run than the limit · 5 none of these.',
				},
				{
					names: [BOARD_THEME],
					description:
						'no alert while throughput is unread or cut for height: only that rule carries it.',
				},
				{
					names: [BOARD_THEME, MATRIX_THEME],
					description:
						'names the board `JOSH-WOPR` / `josh-trace` in place of `josh-board`, in the header and the no-run line (`run-board-theme-defs.ts` → `name`).',
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
						'draws as `--theme wargames` does, red and amber kept, with the text as written (only `wargames` draws capitals; `run-board-theme-defs.ts` → `capitals`), uncolored text in green phosphor (`green` without 24-bit color) and `TRACE ■■■■-` in place of `DEFCON`: one more `■` per level nearer 1, blinking red at 1 (`run-board-header-trace.ts`). No lamps or typed rows.',
				},
				{
					names: [MATRIX_THEME],
					description:
						'a live board types three lead lines in bright green, erasing each, then shows `Knock, knock, Josh.` at once (`run-board-theme-defs.ts`); a key skips it. None with no TTY or color.',
				},
				{
					names: [MATRIX_THEME],
					description:
						'a live board traces a new header notice between redraws: its letters spin as rain glyphs and lock from the left, then a green inverse bar blinks and the notice stays bright a while; the change flash leaves its columns alone. A notice already there when the board opens draws as it is; none with no TTY or color (`run-board-notice-turn.ts`, `run-board-notice-trace.ts`).',
				},
				{
					names: [BTTF_THEME],
					description:
						'names the board `josh-flux` and types its opening line as written; no alert sound. The keypad beeps every two letters while any row types, and ENTER once each has typed through (`run-board-sound-keypad.ts`, `run-board-sound-enter.ts`).',
				},
				{
					names: [BTTF_THEME],
					description:
						'every row that starts typing on a live board starts the time jump, which jumps on the tick after its last letter; a row that starts while a jump runs starts none, one that starts once it has thawed does (`run-board-jump-start.ts`).',
				},
				{
					names: [BTTF_THEME],
					description:
						'a live board draws the flux capacitor in the lamp panel’s place: a lamp gauge right-aligned at the throughput rule’s end, the Y of lamps left of it with its red bar, and the speed readout `NN.N` in the throughput rule over the Y; the gauge moves only when the speed range changes (`run-board-flux-panel.ts`). None where the WOPR lamp panel would not show.',
				},
				{
					names: [BTTF_THEME],
					description:
						'uncolored text in grey, dim text at 55% of it, `─` rules in slate; state colors kept.',
				},
				{
					names: [BTTF_THEME],
					description:
						'the header’s rows in the time circuits’ red, green and amber, the colon at 30% (`run-board-tint.ts`).',
				},
				{
					names: ['--frame'],
					description:
						'one live-form frame in a state its flags fix, for reading what only a live board draws; no frame record, cue or screen control (`run-board-frame-preview.ts`). `--notice <row state>` (`running`, `merged`, …) with `--issue <n>` and `--repeat` (`×2`) sets the notice; `--mute` draws `🔇`; `--columns` / `--rows` the size (120×40); `--ansi` keeps SGR.',
				},
				{
					names: ['--frame'],
					description:
						'draws a theme’s animation area (the `bttf` flux capacitor) as a live board’s first turn does: over the plain text, or under `--ansi` as cursor writes after the frame.',
				},
				{
					names: ['--timing'],
					description:
						'after the `--once` frame, or once a live board leaves its screen, writes how long each phase of the first frame took (ms). `--chat`, `--every` and `--frame` ignore it.',
				},
				{
					names: ['--timing'],
					description:
						"on a live board, adds each kind of draw's max and median, then its main-thread stalls of 200 ms or more: their count, and the longest ten each with its length, the loop's stage that held it (`redraw` or `turn`), the GC within it and when it began (`at`, ms from the screen taken; `run-board-stall.ts`).",
				},
				{
					names: ['--timing'],
					description:
						'on a live board, `wake lag` is the stall probe’s lateness and `spin wake lag` each spinner wake’s past its due time: max, median and the wakes over 50 ms.',
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
	'board:replay': {
		script: 'scripts/run/board/run-board-replay-main.ts',
		// Its imports reach `run:board`'s Telegram sender, which the replay never calls; `.env` loads as there.
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		description:
			'Replay the live board on a virtual clock and a seed, one JSON beat line per beat it writes',
		category: 'AI tools',
		reference: [
			'[--theme wargames|matrix|bttf] [--icons emoji|letters|shapes] [--seed <n>] [--at <epoch ms>] [--ticks <n>] [--mute] [--columns <n>] [--rows <n>]',
			'automation',
			['files', 'network'],
		],
		is_read_only: true,
		usage: {
			examples: [
				{ arguments: `${BTTF_THEME} --seed 1`, note: 'the bttf arrival, each beat 50 ms apart' },
				{ arguments: `${MATRIX_THEME} --seed 2 --at 0`, note: 'the rain another seed draws' },
			],
		},
	},
	'board:compare': {
		script: 'tools/board/board-compare-cli.ts',
		// It replays the board as `board:replay` does, so its imports and `.env` load the same way.
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		description:
			'Compare a theme demo and the replayed board cell by cell per beat; exit 1 at the first divergence',
		category: 'AI tools',
		reference: [
			'<demo.mjs> --theme <theme> [--scene <n>] [--seed <n>] [--steps <n>] [--loose] [--columns <n>] [--rows <n>]',
			'automation',
			['files', 'network', 'processes'],
		],
		is_read_only: true,
		// Kit-only: it imports the kit devDependency `@xterm/headless`, and the theme demos it
		// compares live in kit's own skills.
		is_kit_only: true,
		usage: {
			examples: [
				{ arguments: `<demo.mjs> ${BTTF_THEME}`, note: 'cell by cell' },
				{ arguments: `<demo.mjs> ${MATRIX_THEME} --loose`, note: 'glyph and color sets' },
			],
		},
	},
	wait: {
		script: 'scripts/run/run-wait-main.ts',
		description:
			'Wait until a pid or process ends or a file exists, or one ship:wait chunk (done | pending)',
		category: 'AI tools',
		reference: [
			'[--pid <pid> | --process <pattern> | --file <path> | --result <dir>]',
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
