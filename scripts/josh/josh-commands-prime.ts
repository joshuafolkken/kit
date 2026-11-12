import { OPTIONAL_ENV_FILE_FLAGS, type CommandEntry } from './josh-command-types'

// `run:tidy` and `run:prime`, the once-per-repository sweep and the preparation that runs it.
// `RUN_COMMANDS` spreads this in after `PAUSE_COMMANDS`, so the map keeps its order.

const PRIME_COMMANDS: Record<string, CommandEntry> = {
	'run:tidy': {
		script: 'scripts/run/tidy/run-tidy-main.ts',
		description: 'Close merged lanes and drop stashes whose issues are all merged',
		category: 'AI tools',
		reference: ['', 'automation', ['git', 'network', 'files']],
		usage: { examples: [{ arguments: '' }] },
	},
	'run:prime': {
		script: 'scripts/run/prime/run-prime-cli.ts',
		description:
			'Prepare the primary checkout once before a backlogrun’s first lane: main:sync, latest:if-required, the update stashed, lane:prune, run:tidy',
		category: 'AI tools',
		// `latest:if-required` underneath runs `josh latest`, which reads `.env`.
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		reference: ['', 'automation', ['git', 'network', 'files', 'processes']],
		usage: {
			examples: [{ arguments: '', note: 'prints `latest <scope>` and `stash <message>|clean`' }],
		},
	},
}

export { PRIME_COMMANDS }
