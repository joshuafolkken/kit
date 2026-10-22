import type { CommandEntry } from './josh-command-types'

const PRE_TOOL_USE = 'run by the PreToolUse hook, the pending tool call as JSON on stdin'

// The Claude Code and Codex hook commands, split out of `josh-commands-development.ts` when each
// command's usage moved onto its entry (#4185). `DEV_COMMANDS` spreads this in at the same place, so
// the map keeps its order.

/* eslint-disable @typescript-eslint/naming-convention */
const AGENT_HOOK_COMMANDS: Record<string, CommandEntry> = {
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
		// **No `tsx_arguments`, deliberately.** `JOSH_BATCH_GUARD` and the other guard switches are
		// per-machine preferences kept in `.env`, which every other command reads through
		// `OPTIONAL_ENV_FILE_FLAGS` — but declaring any `tsx_arguments` disqualifies a command from
		// in-process dispatch (`josh-in-process.ts`), and this is the one PreToolUse hook consumers run
		// before every guarded call, where a second ~0.16 s tsx start is not affordable. Each guard it
		// composes loads `.env` through the shared loader instead.
	},
	'stop:guard': {
		script: 'scripts/hooks/stop-guard.ts',
		description:
			'Claude Code Stop hook: send the hold notify, release the hold and print the issue citations itself; block on the rules that need the model (reads the Stop payload on stdin)',
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
			'Claude Code hook: print a non-default JOSH_SESSION_LANG for the session context, and the run:board reply rule while a backlogrun is live (otherwise nothing)',
		category: 'Development',
		reference: ['', 'automation', ['none']],
		usage: {
			examples: [{ arguments: '', note: 'run by the UserPromptSubmit hook; `ja` prints nothing' }],
		},
		// **No `tsx_arguments`, deliberately**, the same as `pretool:guard` above: this runs on every
		// `UserPromptSubmit`, so it must stay eligible for in-process dispatch rather than pay a second
		// tsx start each turn. It calls `process.loadEnvFile` itself through the shared loader.
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
/* eslint-enable @typescript-eslint/naming-convention */

export { AGENT_HOOK_COMMANDS }
