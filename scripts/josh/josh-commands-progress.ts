import { OPTIONAL_ENV_FILE_FLAGS, type CommandEntry } from './josh-command-types'

// The run's progress, board and hand-off commands, split out of `josh-commands-run.ts` when each
// command's usage moved onto its entry (#4185). `RUN_COMMANDS` spreads this in at the same place, so
// the map keeps its order.

/* eslint-disable @typescript-eslint/naming-convention */
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
		reference: ['[--once | --chat | --every <minutes>]', 'automation', ['files', 'network']],
		usage: {
			examples: [
				{ arguments: '', note: 'redraw until interrupted' },
				{ arguments: '--once', note: 'one frame, then exit' },
				{ arguments: '--chat', note: 'one frame for a chat, recorded as a progress report' },
				{
					arguments: '--every 5',
					note: 'the --chat frame as a 📊 Progress Telegram every 5 minutes, until the run ends',
				},
			],
			flags: [
				{
					names: ['--chat'],
					description:
						'answers a `backlogrun` progress question: the frame `--once` draws, with only `🧠` on the machine line and no escapes; it records the report as `run:progress --mark` does.',
				},
				{
					names: ['--every <minutes>'],
					description:
						'sends the `--chat` frame as a `📊 Progress` Telegram now and every `<minutes>` until the run ends — only when a person asks for it.',
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
					arguments: 'kickoff new --brief-file <path>',
					note: 'waits; prints its final message and URLs',
				},
				{
					arguments: 'fullrun <N> --brief-file <path>',
					note: 'detached; a bare N is #N; check it with run:progress --once',
				},
				{
					arguments: 'backlogrun <E> --only',
					note: 'josh backlogrun with this session’s --agent',
				},
			],
		},
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { PROGRESS_COMMANDS }
