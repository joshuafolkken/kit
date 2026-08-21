const ENV_FILE_FLAGS: ReadonlyArray<string> = ['--env-file=.env']
// `--env-file` aborts when the file is missing, which is correct for a command that cannot work
// without the personal variables. A command whose variables are all optional uses this form
// instead, so a project with no `.env` keeps working on the documented defaults.
const OPTIONAL_ENV_FILE_FLAGS: ReadonlyArray<string> = ['--env-file-if-exists=.env']

type CommandCategory =
	'Development' | 'Project' | 'Workflow' | 'Versioning' | 'Maintenance' | 'Git hooks' | 'AI tools'

interface CommandEntry {
	script?: string
	shell?: ReadonlyArray<string>
	description: string
	category: CommandCategory
	tsx_arguments?: ReadonlyArray<string>
	default_script_arguments?: ReadonlyArray<string>
	// Composite (`sh -c`) commands reject extra CLI arguments instead of swallowing them; this
	// names the sub-commands that do accept them, so the refusal points somewhere useful.
	argument_targets?: ReadonlyArray<string>
}

const PE = ['pnpm', 'exec'] as const
const ESLINT_CACHE_FLAGS = ['--cache', '--cache-strategy', 'content'] as const

export type { CommandCategory, CommandEntry }
export { ENV_FILE_FLAGS, ESLINT_CACHE_FLAGS, OPTIONAL_ENV_FILE_FLAGS, PE }
