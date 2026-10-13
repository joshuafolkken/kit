import type { Scenario } from './fresh-machine-spec'

// The script one container runs. Every command is printed before it runs and its exit status after,
// so the log reads as a terminal session; the first failing command ends the run, and the probes
// that follow a clean run are recorded whatever they exit with.

const SEED_MOUNT = '/seed'
const PACK_MOUNT = '/pack'
const COPY_SEED = `cp -R ${SEED_MOUNT}/. .`
const PROBES_HEADING = '# probes — recorded, never failing the run'
const ESCAPED_QUOTE = String.raw`'\''`
const PREAMBLE = [
	String.raw`step() { printf '\n$ %s\n' "$1"; eval "$1"; local code=$?; printf '[exit %s]\n' "$code"; return "$code"; }`,
	'mkdir -p "$HOME/$RUN_NAME" && cd "$HOME/$RUN_NAME" || exit 1',
]

function quote(command: string): string {
	const escaped = command.split("'").join(ESCAPED_QUOTE)

	return `'${escaped}'`
}

function required(command: string): string {
	return `step ${quote(command)} || exit $?`
}

function probe_lines(probes: ReadonlyArray<string>): Array<string> {
	if (probes.length === 0) return []

	return [
		String.raw`printf '\n%s\n' ${quote(PROBES_HEADING)}`,
		...probes.map((probe) => `step ${quote(probe)}`),
	]
}

function build(scenario: Scenario): string {
	const seed = Object.keys(scenario.files).length > 0 ? [COPY_SEED] : []
	const commands = [...seed, ...scenario.commands].map((command) => required(command))

	return [...PREAMBLE, ...commands, ...probe_lines(scenario.probes), 'exit 0', ''].join('\n')
}

const fresh_machine_script = { build, SEED_MOUNT, PACK_MOUNT }

export { fresh_machine_script }
