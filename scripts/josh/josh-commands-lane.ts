import { OPTIONAL_ENV_FILE_FLAGS, type CommandEntry } from './josh-command-types'

// The `lane:*` command registry, split out of `josh-commands-ai.ts` so that file stays under its line
// limit (joshuafolkken/kit#2162). One script answers `lane:open` / `lane:close` / `lane:list` /
// `lane:prune` / `lane:output` / `lane:dispatch` / `lane:await`, told apart by the verb below;
// `lane:launch` is the composite that opens, pops-and-installs on the first lane, and dispatches.
const LANE_SCRIPT = 'scripts/lane/lane-cli.ts'
// `JOSH_LANE_ROOT` and `JOSH_LANE_LIMIT` are personal, non-committed settings, so every lane command
// has to read `.env` to see them — without this the two are documented and unreachable.
const LANE_ARGUMENTS = { script: LANE_SCRIPT, tsx_arguments: OPTIONAL_ENV_FILE_FLAGS } as const
const ISSUE_WITH_OPTIONS = '<issue> [options]'

/* eslint-disable @typescript-eslint/naming-convention */
const LANE_COMMANDS: Record<string, CommandEntry> = {
	'lane:open': {
		...LANE_ARGUMENTS,
		description: 'Open a lane: a linked work tree with its own branch and its own port seed',
		category: 'AI tools',
		reference: [ISSUE_WITH_OPTIONS, 'automation', ['files', 'git']],
		default_script_arguments: ['open'],
	},
	'lane:close': {
		...LANE_ARGUMENTS,
		description: 'Close a lane, leaving no work tree, branch or directory behind',
		category: 'AI tools',
		reference: ['<issue>', 'automation', ['files', 'git']],
		default_script_arguments: ['close'],
	},
	'lane:list': {
		...LANE_ARGUMENTS,
		description: 'List the open lanes: which issue, which ports, and where each one is',
		category: 'AI tools',
		reference: ['', 'automation', ['none']],
		default_script_arguments: ['list'],
	},
	'lane:prune': {
		...LANE_ARGUMENTS,
		description: 'Close every lane an interruption left without its work tree',
		category: 'AI tools',
		reference: ['', 'automation', ['files', 'git']],
		default_script_arguments: ['prune'],
	},
	'lane:output': {
		...LANE_ARGUMENTS,
		description: 'Record, or read back, where the unit running a lane’s child writes',
		category: 'AI tools',
		reference: ['<issue> [path]', 'automation', ['files']],
		default_script_arguments: ['output'],
	},
	'lane:dispatch': {
		...LANE_ARGUMENTS,
		description: 'Start a lane’s child as a detached process that outlives this session',
		category: 'AI tools',
		reference: ['<issue> <prompt>', 'automation', ['processes']],
		default_script_arguments: ['dispatch'],
	},
	'lane:await': {
		...LANE_ARGUMENTS,
		description:
			'Block until any of the named in-flight lane children completes; prints which one finished',
		category: 'AI tools',
		reference: ['<issue> [<issue>...]', 'automation', ['processes']],
		default_script_arguments: ['await'],
	},
	'lane:launch': {
		script: 'scripts/lane/lane-launch-cli.ts',
		description:
			'Collapse a backlogrun lane-start event into one call: open the lane, pop and re-install on the first, dispatch the child',
		category: 'AI tools',
		reference: ['<issue> [--stash <message>]', 'automation', ['files', 'git', 'processes']],
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { LANE_COMMANDS }
