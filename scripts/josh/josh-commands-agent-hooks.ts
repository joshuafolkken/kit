import type { CommandEntry } from './josh-command-types'

const PRE_TOOL_USE = 'run by the PreToolUse hook, the pending tool call as JSON on stdin'

// The Claude Code and Codex hook commands, split out of `josh-commands-development.ts` when each
// command's usage moved onto its entry (#4185). `DEV_COMMANDS` spreads this in at the same place, so
// the map keeps its order.

const AGENT_HOOK_COMMANDS: Record<string, CommandEntry> = {
	'usage:tee': {
		script: 'scripts/usage/usage-tee-cli.ts',
		description: 'Record account-wide Claude statusLine rate limits without printing output',
		category: 'Development',
		reference: ['', 'automation', ['files']],
		usage: {
			examples: [{ arguments: '', note: 'Claude statusLine JSON on stdin; stdout stays empty' }],
		},
	},
	'format:edited': {
		script: 'scripts/hooks/format-edited-cli.ts',
		description: 'Claude Code hook: format the file just edited (reads the tool call on stdin)',
		category: 'Development',
		reference: ['', 'automation', ['files', 'processes']],
		usage: {
			examples: [
				{ arguments: '', note: 'run by the PostToolUse hook, the tool call as JSON on stdin' },
			],
		},
	},
	'pretool:guard': {
		script: 'scripts/hooks/pretool-guard-cli.ts',
		description:
			'Claude Code hook: the batch, investigation and rule guards in one process (reads the tool call on stdin)',
		category: 'Development',
		reference: ['', 'automation', ['none']],
		usage: { examples: [{ arguments: '', note: PRE_TOOL_USE }] },
		// **No `tsx_arguments`, deliberately.** The guards read `.env` for their other values, as other
		// commands do through `OPTIONAL_ENV_FILE_FLAGS`; the guard switches themselves come from the
		// launch environment alone (`josh-environment-file.ts`). Each guard it composes loads `.env`
		// through the shared loader on its real hook path instead, so the unit tests never see a
		// developer's `.env`.
	},
	// The hook ledger read per rule (joshuafolkken/kit#6664): which rules refuse, and how often wrongly.
	// `--apply` / `--restore` write the demoted-rules file (joshuafolkken/kit#6591).
	'hook:ledger': {
		script: 'scripts/hooks/hook-ledger-cli.ts',
		is_read_only: true,
		write_flags: ['--apply', '--restore'],
		description:
			'Print Claude Code hook refusals per hook and rule over a period: refusals, the same call passing later, and route:interrupt issues naming the rule; list, demote or restore rules that mostly refuse allowed work',
		category: 'Development',
		reference: [
			'--period <days> [--demote [--apply]] | --restore <rule>',
			'maintainer',
			['network', 'files'],
		],
		usage: {
			examples: [
				{ arguments: '--period 7', note: "a 7-day period's refusals per rule" },
				{ arguments: '--period 7 --demote', note: 'rules to demote from blocking to notice' },
				{
					arguments: '--period 7 --demote --apply',
					note: 'record them in .josh/hook-demoted.json',
				},
				{ arguments: '--restore batching', note: 'make a demoted rule block again' },
			],
		},
	},
	'stop:guard': {
		script: 'scripts/hooks/stop-guard.ts',
		description:
			'Claude Code Stop hook: send the hold notify and release the hold itself; block on the rules that need the model (reads the Stop payload on stdin)',
		category: 'Development',
		reference: ['', 'automation', ['none']],
		usage: {
			examples: [
				{ arguments: '', note: 'run by the Stop hook, the stop payload as JSON on stdin' },
			],
		},
		// **No `tsx_arguments`, deliberately**, the same as `pretool:guard` above: this runs at every
		// turn end, so it must stay eligible for in-process dispatch rather than pay a second tsx start.
		// It loads `.env` through the shared `hook-decision.ts` loader.
	},
	'session:lang': {
		script: 'scripts/josh/session-language-main.ts',
		description:
			'Claude Code hook: print a non-default JOSH_SESSION_LANG for the session context, the run:board reply rule while a backlogrun is live, and the run:handoff line for a workflow keyword on a consultation model (otherwise nothing)',
		category: 'Development',
		reference: ['', 'automation', ['none']],
		usage: {
			examples: [{ arguments: '', note: 'run by the UserPromptSubmit hook; `ja` prints nothing' }],
		},
		// **No `tsx_arguments`, deliberately**, the same as `pretool:guard` above: this runs on every
		// `UserPromptSubmit`, so it must stay eligible for in-process dispatch rather than pay a second
		// tsx start each turn. It loads `.env` itself through the shared loader.
	},
	'codex:hook-adapter': {
		script: 'scripts/hooks/codex-hook-adapter.ts',
		description:
			'Codex hook: run the pretool or posttool guard on a Codex payload (reads the tool call on stdin)',
		category: 'Development',
		reference: ['<pretool|posttool>', 'automation', ['none']],
		usage: {
			examples: [
				{ arguments: 'pretool', note: 'a Codex PreToolUse payload on stdin' },
				{ arguments: 'posttool', note: 'a Codex PostToolUse payload on stdin' },
			],
		},
		// The live-source fallback `scripts/hooks/run-hook.sh` derives from the `codex-hook-adapter`
		// bundle name. **No `tsx_arguments`**, the same as `pretool:guard`
		// above: it runs before every guarded Codex call.
	},
}

export { AGENT_HOOK_COMMANDS }
