import { run_board_theme_aliases } from '#scripts/run/board/run-board-theme-aliases'
import { OPTIONAL_ENV_FILE_FLAGS, type CommandEntry } from './josh-command-types'

// The run's progress, board and hand-off commands, split out of `josh-commands-run.ts` when each
// command's usage moved onto its entry (#4185). `RUN_COMMANDS` spreads this in at the same place, so
// the map keeps its order.

// joshuafolkken/kit#8917: the `--theme` values — the board's name after `josh-` — and their aliases,
// read off `run-board-theme-defs.ts` (`THEMES`, `THEME_ALIASES`), so the usage never drifts from them.
const THEME_VALUES = run_board_theme_aliases.value_text()
const THEME_ALIAS_TEXT = run_board_theme_aliases.alias_text()
const THEME_FLAG = '--theme <value>'
const WOPR_THEME = '--theme wopr'
const TRACE_THEME = '--theme trace'
const FLUX_THEME = '--theme flux'

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
			`[--once | --chat [--fresh] | --every <minutes> | --frame [<frame flags>]] [--theme wopr|trace|flux|codec|nixie|skynet|magi|rk800|isac|ghost] [--icons emoji|letters|shapes] [--sound on|off] [--timing]`,
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
				{ arguments: WOPR_THEME, note: 'the WOPR board, its opening, events and DEFCON' },
				{ arguments: TRACE_THEME, note: 'the trace program’s rain and its TRACE gauge' },
				{ arguments: '--theme metalgear', note: 'an alias: the codec board' },
				{ arguments: '--icons letters', note: 'every icon as two-letter capitals' },
				{
					arguments: '--sound off',
					note: 'a silent board for this launch, the saved switch untouched',
				},
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
					names: [THEME_FLAG],
					description: `draws a live board in a theme, each the work its board is named after: ${THEME_VALUES}. \`JOSH_BOARD_THEME=<value>\` sets it for every board (\`backlogrun\` too), \`--theme\` wins; unknown names are refused; \`--chat\` and \`--every\` never take it.`,
				},
				{
					names: ['--theme <alias>'],
					description: `read as the value it names: ${THEME_ALIAS_TEXT}.`,
				},
				{
					names: [THEME_FLAG],
					description:
						'the theme host draws it (`run-board-theme-registry.ts`): the theme’s opening (a key skips it), its idle board, its PROGRESS, ROW and NOTICE as the board’s events arrive, its spinner and the clock colons, its level over the throughput rule, and its ending on Ctrl-C (any key leaves at once). Only in 24-bit color: a terminal without it, or no TTY, draws the board in no theme.',
				},
				{
					names: [THEME_FLAG],
					description:
						'the base under the theme is drawn in one palette the host reads back as roles (`run-board-theme-defs.ts` → `BASE_LOOK`), with the lamp panel the theme lays its panel out by (`run-board-lamps.ts`); a single frame (`--once`, `--frame`) in a theme draws that base.',
				},
				{
					names: [THEME_FLAG],
					description:
						'sounds: the typing trill while a row types and the opening’s sound — wopr the teletype, trace the key click, flux the time-circuit keypad and its ENTER; codec, nixie, skynet and magi the teletype for now; rk800, isac and ghost each their own letters. A Mac plays them through one resident player; frames trail them by the output latency.',
				},
				{
					names: ['--icons <emoji|letters|shapes>'],
					description:
						'`emoji` as drawn; `letters` as ASCII of their width (`🚨` → `P1`; `run-board-theme-glyphs.ts`); `shapes` a state as a shape where it has one (`🔄` → `>>`, `🔗` → `<-`, `⏸` → `║`). Unset: `emoji` with no theme, else `shapes`. No theme: tone color only. `JOSH_BOARD_ICONS` sets it, `--icons` wins; unknown names refused; not for `--chat` / `--every`.',
				},
				{
					names: [THEME_FLAG],
					description:
						'drops an icon drawn beside the label that says what it marks (`CPU`, `QUEUED`), keeping one before a value (`CP 67%`): in a column’s rule its place is the rule, a heading reads `V -- NAME`, a row label moves into its place. One helper marks them (`run-board-label-pair.ts`); no theme and `--chat` draw as before.',
				},
				{
					names: ['--sound <on|off>'],
					description:
						"sets this launch's sound over the saved switch (`s`, below): `off` starts no sound, not even after `s`; `on` starts on. Neither reads nor writes `board.json`'s `sound`; without it the saved switch decides. A value other than `on` / `off`, or none, is refused with the usage. A pty with no screen (a measurement, a recording) launches with `--sound off`.",
				},
				{
					names: ['--frame'],
					description:
						'one live-form frame in a state its flags fix, for reading what only a live board draws; no frame record, cue or screen control (`run-board-frame-preview.ts`). `--notice <row state>` (`running`, `merged`, …) with `--issue <n>` and `--repeat` (`×2`) sets the notice; `--mute` draws `🔇`; `--columns` / `--rows` the size (120×40); `--ansi` keeps SGR.',
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
		reference: [
			'<keyword> [N|new ...] --brief-file <path> [--wip <name>]',
			'automation',
			['processes', 'files'],
		],
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
			'Replay the live board on a virtual clock, one JSON beat line per beat it writes; `--seed` is taken and ignored',
		category: 'AI tools',
		reference: [
			'[--theme wopr|trace|flux|codec|nixie|skynet|magi|rk800|isac|ghost] [--icons emoji|letters|shapes] [--seed <n>] [--at <epoch ms>] [--ticks <n>] [--mute] [--columns <n>] [--rows <n>]',
			'automation',
			['files', 'network'],
		],
		is_read_only: true,
		usage: {
			examples: [
				{ arguments: FLUX_THEME, note: 'the flux opening, each beat 50 ms apart, in 24-bit color' },
				{ arguments: `${TRACE_THEME} --at 0`, note: 'the trace board from the epoch' },
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
				{ arguments: `<demo.mjs> ${FLUX_THEME}`, note: 'cell by cell' },
				{ arguments: `<demo.mjs> ${TRACE_THEME} --loose`, note: 'glyph and color sets' },
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
