import type { CommandUsage } from './josh-command-types'

// The usage of the commands `docs/josh-commands-run.md` documents from `run:progress` on — the run's
// watchers, the lanes, and the session-budget and document-reading commands — keyed by command name.
// The page's usage blocks are generated from this table and `josh help <command>` prints it, so an
// example or a flag is written once, here (#3937). The run lifecycle before it is `josh-usage-run.ts`.
const BARE = { arguments: '' }
const PATH_DIR = '--path <dir>'

/* eslint-disable @typescript-eslint/naming-convention */
const SESSION_USAGE: Readonly<Record<string, CommandUsage>> = {
	'run:progress': {
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
					'start once in the background: each report goes to the event stream and ambient log, never stdout; exits only on an arrival, `josh followup` ending the run, or `--hours`.',
			},
			{
				names: ['--hours <n>'],
				description: 'how long the watcher lives (default 8 with `--wait`, 1 otherwise).',
			},
			{ names: ['--repo <owner/name>'], description: 'scopes the read.' },
		],
	},
	'run:board': {
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
	'run:watcher:guard': { examples: [BARE] },
	'run:stranded': { examples: [BARE] },
	'lane:open': { examples: [{ arguments: '1490', note: 'prints the lane directory on stdout' }] },
	'lane:close': {
		examples: [{ arguments: '1490' }, { arguments: '--all' }],
		flags: [{ names: ['--all'], description: 'closes every lane.' }],
	},
	'lane:list': { examples: [BARE] },
	'lane:prune': { examples: [BARE] },
	'lane:output': {
		examples: [
			{ arguments: '1713 /abs/path/to/agent-7.jsonl', note: 'record it; prints the path back' },
			{ arguments: '1713', note: 'read it; prints the path, or `none`' },
		],
	},
	'lane:dispatch': {
		examples: [
			{
				arguments: '1749',
				note: "prints the child's pid; a refusal is an empty capture and exit 1",
			},
		],
		flags: [
			{
				names: ['JOSH_{SCHEDULER,WORKER,REVIEWER}_MODEL'],
				description:
					'Claude Code role overrides; Anthropic defaults are respectively `claude-opus-5-5`, `claude-opus-5-5`, and `claude-opus-5-5`. Codex keeps its provider-specific model.',
			},
			{
				names: ['JOSH_{SCHEDULER,WORKER,REVIEWER}_EFFORT'],
				description:
					'role effort overrides for either provider; defaults are `medium`, `medium`, and `high`.',
			},
			{
				names: ['JOSH_REVIEWER_VERIFICATION_{MODEL,EFFORT}'],
				description:
					'review round 2 and later (the verification pass); Anthropic defaults are `claude-sonnet-5-5` / `high`, falling back to `JOSH_REVIEWER_*`.',
			},
		],
	},
	'lane:await': {
		examples: [
			{ arguments: '1749 1750', note: 'block until either lane completes' },
			{
				arguments: '1749 1750 --owner "$PPID"',
				note: 'reclaim the carry record for a resumed conversation first',
			},
		],
	},
	'lane:launch': {
		examples: [
			{ arguments: '1749', note: 'every lane after the first' },
			{
				arguments: '1749 --stash "backlogrun: josh latest before lanes"',
				note: 'the first lane only',
			},
		],
	},
	'lane:sample': { examples: [{ arguments: '', note: 'one machine-load reading' }] },
	'lane:stats': {
		examples: [{ arguments: '--period 7', note: "a 7-day period's stage medians and maxima" }],
	},
	cost: {
		examples: [
			{
				arguments: '--cut',
				note: 'compare billed input per request with the shared 135,000 context-cut threshold',
			},
			{ arguments: '--over <tokens>', note: 'compare with an explicit limit' },
			{ arguments: `--cut ${PATH_DIR}`, note: 'Anthropic project or current OpenAI worktree' },
		],
		flags: [
			{
				names: [PATH_DIR],
				description:
					'selects another Anthropic project; OpenAI accepts only linked checkouts of the current project.',
			},
		],
	},
	'doc:section': {
		examples: [
			{ arguments: '<file.md> "<heading>"' },
			{ arguments: 'backlogrun.md "The hand-off"' },
		],
	},
	'read:set': {
		examples: [
			{ arguments: '', note: 'every entry point' },
			{ arguments: 'backlogrun', note: 'one of them' },
			{ arguments: 'backlogrun --json' },
		],
	},
	'doc:read': {
		examples: [
			{ arguments: 'CLAUDE.md', note: 'under the cap: prints the document' },
			{ arguments: 'backlogrun.md', note: 'over the cap: prints a directive, no content' },
		],
	},
	'read:files': {
		examples: [
			{ arguments: 'a.ts b.ts c.ts', note: 'under the cap: prints each file under its own header' },
			{
				arguments: 'a.ts big.ts',
				note: 'over the cap: prints a directive to Read them in one turn, no content',
			},
		],
	},
	'edit:files': {
		examples: [
			{
				arguments: 'plan.txt',
				note: 'applies every block in the plan, one line per edit reporting the outcome',
			},
			{ arguments: "- <<'EDITS'", note: 'plan from stdin, then EDITS' },
		],
	},
	time: {
		examples: [
			{ arguments: '', note: 'the last run tree, wall clock and cost by role' },
			{ arguments: '--run', note: 'the same run-tree scope, named explicitly' },
			{ arguments: '--json', note: 'the same figures, machine-readable' },
			{ arguments: PATH_DIR, note: "read another project's transcripts from this checkout" },
			{
				arguments: '--split-at 2026-10-16T21:33:19Z',
				note: 'the same tree compared by role before and after a merge',
			},
		],
		flags: [
			{
				names: ['--run'],
				description:
					'(default) the whole run tree, wall clock led beside dollars. It is the only scope; any flag not listed here is a usage error (exit 1). History: `docs/maintainers/josh-commands-run-rationale.md` → "`josh cost` and `josh time` lost their report scopes".',
			},
			{
				names: [PATH_DIR],
				description:
					'aim the read at another project (absolute path); keeps the `cwd` behavior when absent.',
			},
			{ names: ['--json'], description: 'the run tree, machine-readable.' },
			{
				names: ['--split-at <ISO time>'],
				description:
					'add a before → after block by role (time share, cost share, req/session), each session on the side of its first request; an unparseable time is a usage error (exit 1).',
			},
		],
	},
	'cost:audit': {
		examples: [
			{ arguments: '', note: 'the last 7 days against the 7 before' },
			{ arguments: '--period 30', note: 'the last 30 days against the 30 before' },
		],
		flags: [
			{
				names: ['--period <days>'],
				description: 'the length of each period, a positive whole number of days (default 7).',
			},
		],
	},
	retrospective: {
		examples: [{ arguments: '', note: 'the digest for the run this checkout carries' }],
	},
	eval: {
		examples: [
			{ arguments: '', note: 'every scenario' },
			{ arguments: 'consult-not-execute', note: 'one scenario by name' },
		],
		flags: [
			{ names: ['JOSH_EVAL_MODEL'], description: 'the model to run against (default `sonnet`).' },
			{
				names: ['JOSH_EVAL_CONCURRENCY'],
				description:
					'how many sessions run at once (default `5`); a non-positive-integer value is refused.',
			},
		],
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { SESSION_USAGE }
