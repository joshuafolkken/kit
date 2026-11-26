import { existsSync } from 'node:fs'
import path from 'node:path'
import { LEGACY_OBSERVATION_LEDGER_PATHS, OBSERVATION_LEDGER_DIRECTORY } from './observation-ledger'

// The ledger's paths before `.josh/observations/`: the two single files and the directory that came
// between. Nothing reads or migrates them any more, so a ledger left there — a repository not
// checked when the migration was removed, or a consumer still on an old kit — would be silently
// ignored; this names it instead.
const LEGACY_OBSERVATION_LEDGER_DIRECTORY = 'docs/maintainers/observations'

const LEGACY_PATHS: ReadonlyArray<string> = [
	...LEGACY_OBSERVATION_LEDGER_PATHS,
	LEGACY_OBSERVATION_LEDGER_DIRECTORY,
]

function found(root: string): ReadonlyArray<string> {
	return LEGACY_PATHS.filter((legacy) => existsSync(path.join(root, legacy)))
}

function warning(paths: ReadonlyArray<string>): string {
	return `⚠️ Old observation ledger left at ${paths.join(', ')} — it is no longer read. Migrate it with a kit release from before joshuafolkken/kit#9049, or move its lines into ${OBSERVATION_LEDGER_DIRECTORY}/ by hand.`
}

// **One line, asked once per commit of the ledger** (`observation-ledger-prepare.ts`), not on every
// path lookup: the lookup runs on each read and append, and must touch no file.
function warn(root: string): void {
	const paths = found(root)

	if (paths.length > 0) console.warn(warning(paths))
}

const observation_ledger_legacy = { found, warn }

export { LEGACY_OBSERVATION_LEDGER_DIRECTORY, observation_ledger_legacy }
