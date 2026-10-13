import { project_checks } from '#scripts/gate/project-checks'
import { json_value } from '#scripts/lib/json-value'
import { execa } from 'execa'

// **The unit check of a basic project that carries no vitest is the test script the project itself
// declares** — `scripts.test` in its `package.json`. A basic project is one of any language and any
// runner (`node --test`, jest, mocha, a wrapper around another language's), and its own script is the one statement of
// how its tests run that holds for all of them.
//
// Rejected: detecting `node --test` files and starting that runner here. Every further runner would
// need its own detection and its own invocation, and the project has already written both down.
const PNPM = 'pnpm'
const SCRIPT_NAME = 'test'
const FAIL_EXIT_CODE = 1

// What `npm init` and `pnpm init` write when no test command is given. It exits 1 by design, so
// running it would fail every freshly-initialized project for having declared nothing.
const INIT_PLACEHOLDER = 'echo "Error: no test specified" && exit 1'

// Set on the script this module spawns. A `scripts.test` that calls back into josh (`josh test:unit`,
// `josh gate`) reaches this check again with it set, and running the script from there would recurse
// without end.
const REENTRY_KEY = 'JOSH_PROJECT_TEST_SCRIPT'
const REENTRY_VALUE = '1'

type ProjectScriptState = 'declared' | 'absent' | 'reentrant'

const EMPTY_COMMANDS = new Set(['', INIT_PLACEHOLDER])

function field_of(value: unknown, key: string): unknown {
	return json_value.is_record(value) ? value[key] : undefined
}

function declared_script(project_directory: string): string | undefined {
	const manifest: unknown = project_checks.read_manifest(project_directory)
	const script = field_of(field_of(manifest, 'scripts'), SCRIPT_NAME)
	if (typeof script !== 'string') return undefined

	const command = script.trim()

	return EMPTY_COMMANDS.has(command) ? undefined : command
}

function state(
	project_directory: string,
	environment: NodeJS.ProcessEnv = process.env,
): ProjectScriptState {
	if (declared_script(project_directory) === undefined) return 'absent'

	return environment[REENTRY_KEY] === REENTRY_VALUE ? 'reentrant' : 'declared'
}

// The notice is printed before the spawn, so a reader of the gate's output sees which command stood in
// for vitest rather than a bare runner log under the `test:unit` label.
async function run(project_directory: string, command_label: string): Promise<number> {
	console.info(
		`josh ${command_label}: vitest is not installed — running the project's own test script (${PNPM} run ${SCRIPT_NAME}).`,
	)

	const result = await execa(PNPM, ['run', SCRIPT_NAME], {
		cwd: project_checks.project_root(project_directory),
		env: { [REENTRY_KEY]: REENTRY_VALUE },
		stdio: 'inherit',
		reject: false,
	})

	return result.exitCode ?? FAIL_EXIT_CODE
}

const project_test_script = { INIT_PLACEHOLDER, REENTRY_KEY, declared_script, state, run }

export type { ProjectScriptState }
export { project_test_script }
