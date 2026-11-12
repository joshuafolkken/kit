// `josh ui:shot <route>...` — resolve this project's screenshot command, so the `verify-ui` skill's
// capture is one call rather than a hand-run probe of every candidate. The order lives here alone:
//
// 1. A toolkit (`josh-app`, then `josh-game`) whose usage line lists `shot` — the printed command
//    list decides, never the toolkit's presence (`type-check-step.ts`).
// 2. A project-local `package.json` script named `shot`, `screenshot` or `verify:ui`.
//
// The resolved command prints its own image paths (`josh-app shot` writes `route → file` per
// route), so the paths reach the caller unchanged. Nothing resolved answers with every candidate
// tried, which is the report the skill's fallback starts from.

const TOOLKIT_SUBCOMMAND = 'shot'
const SHOT_SCRIPTS: ReadonlyArray<string> = ['shot', 'screenshot', 'verify:ui']
const PACKAGE_MANAGER = 'pnpm'
const RUN_SCRIPT = 'run'
const MISSING_HEADER = 'ui:shot: no screenshot command in this project — tried:'
const CANDIDATE_INDENT = '  '

interface ShotCommand {
	file: string
	args: ReadonlyArray<string>
}

interface ToolkitProbe {
	path: string
	commands: ReadonlyArray<string>
}

interface ShotSources {
	toolkit_bins: ReadonlyArray<string>
	probe_toolkit: (bin_name: string) => Promise<ToolkitProbe | undefined>
	scripts: ReadonlyArray<string>
}

type ShotResolution =
	{ kind: 'found'; command: ShotCommand } | { kind: 'missing'; tried: ReadonlyArray<string> }

async function resolve_toolkit(
	sources: ShotSources,
	routes: ReadonlyArray<string>,
): Promise<ShotCommand | undefined> {
	for (const bin_name of sources.toolkit_bins) {
		// eslint-disable-next-line no-await-in-loop -- the first toolkit that lists `shot` wins
		const probe = await sources.probe_toolkit(bin_name)

		if (probe?.commands.includes(TOOLKIT_SUBCOMMAND) === true) {
			return { file: probe.path, args: [TOOLKIT_SUBCOMMAND, ...routes] }
		}
	}

	return undefined
}

function resolve_script(
	scripts: ReadonlyArray<string>,
	routes: ReadonlyArray<string>,
): ShotCommand | undefined {
	const script = SHOT_SCRIPTS.find((name) => scripts.includes(name))
	if (script === undefined) return undefined

	return { file: PACKAGE_MANAGER, args: [RUN_SCRIPT, script, ...routes] }
}

function candidate_labels(toolkit_bins: ReadonlyArray<string>): ReadonlyArray<string> {
	return [
		...toolkit_bins.map((bin_name) => `${PACKAGE_MANAGER} ${bin_name} ${TOOLKIT_SUBCOMMAND}`),
		...SHOT_SCRIPTS.map((script) => `${PACKAGE_MANAGER} ${RUN_SCRIPT} ${script}`),
	]
}

async function resolve_shot_command(
	sources: ShotSources,
	routes: ReadonlyArray<string>,
): Promise<ShotResolution> {
	const command =
		(await resolve_toolkit(sources, routes)) ?? resolve_script(sources.scripts, routes)

	if (command === undefined) {
		return { kind: 'missing', tried: candidate_labels(sources.toolkit_bins) }
	}

	return { kind: 'found', command }
}

function describe_missing(tried: ReadonlyArray<string>): string {
	return [MISSING_HEADER, ...tried.map((label) => `${CANDIDATE_INDENT}${label}`)].join('\n')
}

const ui_shot = {
	describe_missing,
	resolve_shot_command,
}

export type { ShotCommand, ShotSources, ToolkitProbe }
export { ui_shot }
