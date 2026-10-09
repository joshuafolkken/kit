import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve_tsx_runner } from '#scripts/josh/josh-logic'

// The git merge drivers `.gitattributes` names, as the `-c` options that register them for one merge.
// `josh main:merge` — the merge every lane and `josh ship` run — passes
// them, so a driver is in force wherever the merge it exists for runs; a merge typed by hand finds
// no driver of that name and falls back to git's own text merge.
//
// **The driver is registered per merge, with `-c`, never written into a git config.** A config
// entry has to be installed in every clone before it does anything, and a clone that missed it
// would quietly conflict again.
//
// **The driver script is located by path, not imported.** It merges kit's own metrics baseline and
// lives under `scripts/metrics/`, which the published package excludes; a consumer's install has no
// such script and no such baseline, so nothing is registered there.

const DRIVER_NAME = 'josh-metrics'
const DRIVER_SCRIPT = fileURLToPath(new URL('../metrics/metrics-merge-driver.ts', import.meta.url))

// git runs the driver through the shell, so each path is quoted against a space in it.
function quoted(text: string): string {
	return `"${text}"`
}

function driver_command(): string {
	const runner = resolve_tsx_runner()
	const words = [runner.executable, ...runner.leading_arguments, DRIVER_SCRIPT].map((word) =>
		quoted(word),
	)

	return [...words, '%O', '%A', '%B'].join(' ')
}

function git_options(): ReadonlyArray<string> {
	if (!existsSync(DRIVER_SCRIPT)) return []

	return [
		'-c',
		`merge.${DRIVER_NAME}.name=josh metrics baseline: add each side's change to the totals`,
		'-c',
		`merge.${DRIVER_NAME}.driver=${driver_command()}`,
	]
}

const merge_drivers = { git_options }

export { merge_drivers }
