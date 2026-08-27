import type { CommandEntry } from './josh-command-types'

/* eslint-disable @typescript-eslint/naming-convention */
const AI_COMMANDS: Record<string, CommandEntry> = {
	prep: {
		script: 'scripts-ai/prep.ts',
		description: 'Pre-implementation preparation',
		category: 'AI tools',
	},
	issue: {
		script: 'scripts-ai/issue-prep.ts',
		description: 'Fetch GitHub issue details',
		category: 'AI tools',
	},
	epic: {
		script: 'scripts-ai/epic.ts',
		description: 'Create an epic issue from its child issue numbers',
		category: 'AI tools',
	},
	'epic:next': {
		script: 'scripts/epic/epic-next.ts',
		description: "List an epic's runnable children, bundled per repository",
		category: 'AI tools',
	},
	'epic:plan': {
		script: 'scripts/epic/epic-plan-cli.ts',
		description: 'Print every child of an epic as JSON, for one batch of decisions',
		category: 'AI tools',
	},
	'epic:bundle': {
		script: 'scripts/epic/epic-bundle-cli.ts',
		description: 'Say whether a newly filed issue belongs with ones already in the backlog',
		category: 'AI tools',
	},
	'epic:audit': {
		script: 'scripts/epic/epic-audit-cli.ts',
		description: "Audit an epic's children against each other for contradictions",
		category: 'AI tools',
	},
	'epic:check': {
		script: 'scripts-ai/epic-check.ts',
		description: 'Check an epic issue against the tracking requirements',
		category: 'AI tools',
	},
	cost: {
		script: 'scripts/cost/cost-cli.ts',
		description: "Report a run's token and credit cost from Claude Code's session transcripts",
		category: 'AI tools',
	},
	'review:level': {
		script: 'scripts/review/review-level-cli.ts',
		description: 'Print the /code-review level this change is reviewed at',
		category: 'AI tools',
	},
	eval: {
		script: 'scripts/eval/eval-run.ts',
		description: 'Run the agent rule-compliance scenarios (real Claude sessions)',
		category: 'AI tools',
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { AI_COMMANDS }
