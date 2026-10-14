import path from 'node:path'
import { z } from 'zod'

// A scenario is everything one `josh fresh:run` needs to know: the files that are in the project
// before anything is installed, the commands a person would type, and the probes recorded after
// them. kit's own six patterns and a consumer toolkit's spec file are the same shape, so the machine
// and the log are shared and nothing about them is kit's alone (joshuafolkken/kit#3714).
//
// Inside the container a command reads `$RUN_NAME` (the numbered project and repository name),
// `$PACKAGE_TARBALL` (the packed checkout, for `package_source: tarball`) and `$PACKAGE_VERSION`
// (the published version, for `package_source: published`).

function is_project_relative(file: string): boolean {
	const normalized = path.posix.normalize(file)

	return !path.posix.isAbsolute(normalized) && !normalized.startsWith('..')
}

const COMMAND_SCHEMA = z.string().min(1)
const SCENARIO_SCHEMA = z.strictObject({
	name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/u),
	// A GitHub scenario runs on the image that also has git and gh, and receives the host's token.
	requires_github: z.boolean().default(false),
	// A Claude Code scenario receives the host's long-lived token as `CLAUDE_CODE_OAUTH_TOKEN`.
	requires_claude: z.boolean().default(false),
	package_source: z.enum(['tarball', 'published']).default('tarball'),
	files: z.record(z.string().refine(is_project_relative), z.string()).default({}),
	// A failing command ends the run; a failing probe is only recorded.
	commands: z.array(COMMAND_SCHEMA).min(1),
	probes: z.array(COMMAND_SCHEMA).default([]),
})

type Scenario = z.infer<typeof SCENARIO_SCHEMA>
type ScenarioInput = z.input<typeof SCENARIO_SCHEMA>

function define(input: ScenarioInput): Scenario {
	return SCENARIO_SCHEMA.parse(input)
}

function problems(error: z.ZodError): string {
	return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
}

// A spec file is written by hand in another repository, so a mistake is reported as the fields that
// are wrong rather than as a stack trace.
function parse(json: string): Scenario {
	const result = SCENARIO_SCHEMA.safeParse(JSON.parse(json))

	if (!result.success) throw new Error(`Invalid scenario spec — ${problems(result.error)}`)

	return result.data
}

const fresh_machine_spec = { define, parse }

export { fresh_machine_spec }
export type { Scenario, ScenarioInput }
