import type { PackageVersionConfig } from './version-command-config'

// One upgrade the version commands offer and run: `text` is the line printed after `Run:`, and
// `steps` are the argument vectors executed in order, each only after the one before it succeeded.
// A command kit builds itself is spawned without a shell, so a registry-supplied version is never
// parsed by one; only the consumer's own configured command goes through `sh -c`.
interface UpgradeCommand {
	text: string
	steps: ReadonlyArray<ReadonlyArray<string>>
}

const STEP_SEPARATOR = ' && '

function update_scope_flag(is_local: boolean): string {
	return is_local ? '-D' : '-g'
}

function update_argv(
	latest: string,
	is_local: boolean,
	config: PackageVersionConfig,
): Array<string> {
	return ['pnpm', 'add', update_scope_flag(is_local), `${config.package_name}@${latest}`]
}

// The bare `pnpm add` invocation that installs one package at an exact version, in the global or the
// project (dev-dependency) scope.
function format_update_command(
	latest: string,
	is_local: boolean,
	config: PackageVersionConfig,
): string {
	return update_argv(latest, is_local, config).join(' ')
}

// The upgrade for one target. A project-scope install is followed by kit's lockfile repair
// (`fix-gh-packages`), which a global install does not need. The printed text is derived from the
// steps, so the hint and what actually runs cannot drift apart.
function build_upgrade_command(
	latest: string,
	is_local: boolean,
	config: PackageVersionConfig,
): UpgradeCommand {
	const steps = [update_argv(latest, is_local, config)]
	if (is_local) steps.push(['node_modules/.bin/tsx', config.fix_gh_packages_path])

	return { text: steps.map((step) => step.join(' ')).join(STEP_SEPARATOR), steps }
}

// The consumer's own configured command — `pnpm add -g …`, or a chain with `&&` — is inside the trust
// boundary and needs a shell to mean what it says.
function shell_upgrade_command(command: string): UpgradeCommand {
	return { text: command, steps: [['sh', '-c', command]] }
}

function build_upgrade_shell_command(
	latest: string,
	is_local: boolean,
	config: PackageVersionConfig,
): string {
	return build_upgrade_command(latest, is_local, config).text
}

export type { UpgradeCommand }
export {
	build_upgrade_command,
	build_upgrade_shell_command,
	format_update_command,
	shell_upgrade_command,
}
