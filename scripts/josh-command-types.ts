const ENV_FILE_FLAGS: ReadonlyArray<string> = ['--env-file=.env']

type CommandCategory =
	| 'Development'
	| 'Project'
	| 'Workflow'
	| 'Versioning'
	| 'Maintenance'
	| 'Git hooks'
	| 'AI tools'

interface CommandEntry {
	script?: string
	shell?: ReadonlyArray<string>
	description: string
	category: CommandCategory
	tsx_arguments?: ReadonlyArray<string>
	requires_sveltekit?: true
}

const PE = ['pnpm', 'exec'] as const
const ESLINT_CACHE_FLAGS = ['--cache', '--cache-strategy', 'content'] as const

export type { CommandCategory, CommandEntry }
export { ENV_FILE_FLAGS, ESLINT_CACHE_FLAGS, PE }
