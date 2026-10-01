import { execaSync } from 'execa'

interface InstallStep {
	label: string
	command: string
	args: ReadonlyArray<string>
	env?: Readonly<Record<string, string>>
}

interface InstallRequest {
	is_install: boolean
	rest: ReadonlyArray<string>
}

const NO_INSTALL_FLAG = '--no-install'
const INSTALL_STEP: InstallStep = { label: 'pnpm install', command: 'pnpm', args: ['install'] }
const FORMAT_STEP: InstallStep = {
	label: 'pnpm josh format',
	command: 'pnpm',
	args: ['exec', 'josh', 'format'],
}
const INSTALL_FAILURE = [
	`${INSTALL_STEP.label} failed — fix the cause above,`,
	`then run it manually: ${INSTALL_STEP.label} && ${FORMAT_STEP.label}`,
].join(' ')
const FORMAT_WARNING = [
	`  ⚠ ${FORMAT_STEP.label} left problems it could not fix in the project's own files —`,
	`the setup itself succeeded; fix them, then run: ${FORMAT_STEP.label}`,
].join(' ')

// The flag is peeled off before the `--profile` pair is parsed, so the profile parser stays the one
// `josh start` shares.
function split_install_flag(args: ReadonlyArray<string>): InstallRequest {
	return {
		is_install: !args.includes(NO_INSTALL_FLAG),
		rest: args.filter((argument) => argument !== NO_INSTALL_FLAG),
	}
}

function did_step_succeed(step: InstallStep, project_root: string): boolean {
	console.info(`\n$ ${step.label}`)
	const result = execaSync(step.command, step.args, {
		cwd: project_root,
		env: step.env ?? {},
		stdio: 'inherit',
		reject: false,
	})

	return result.exitCode === 0
}

// Returns the failure to report, or undefined once the install passed. A failed install stops
// there: `josh format` runs prettier and the kit itself, both of which the install provides. A failed
// format does not fail `init` — in a full project it also runs `eslint --fix`, which exits non-zero on
// the project's own unfixable errors, and those are the project's result, not the setup's (the
// reason `josh gate` is left out of `init` too).
function run_post_init_steps(project_root: string): string | undefined {
	console.info('\nDependencies:')
	if (!did_step_succeed(INSTALL_STEP, project_root)) return INSTALL_FAILURE
	if (!did_step_succeed(FORMAT_STEP, project_root)) console.warn(FORMAT_WARNING)

	return undefined
}

const init_install = { NO_INSTALL_FLAG, split_install_flag, did_step_succeed, run_post_init_steps }
export { init_install }
export type { InstallStep }
