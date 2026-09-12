import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { ENV_FILE_NAME, PORT_SEED_KEY, ports } from '#ports'
import { lane_environment } from '#scripts/lane/lane-environment'

// Each discovered repository's port seed and the dev / preview ports it resolves to, plus which
// repositories share a seed (joshuafolkken/kit#1494).
//
// The formula `seed × 10 + lane` makes distinct seeds occupy disjoint bands, but two repositories on
// the *same* seed still collide — as do the many that never set one and sit together on seed 0. That
// clash surfaces only as an E2E run failing to bind a port somewhere else, so `doctor` names it here
// instead. **`.env` is never rewritten**: the seed is a personal, per-machine setting, so the report
// points at the clash and a person resolves it.

const HEADING = 'Port seeds (dev / preview, and repositories sharing one):'
const UNREADABLE = 'PORT_SEED could not be read'
const ROW_INDENT = '  '
const COLUMN_SEPARATOR = '  '
const SHARED_PREFIX = '  ⚠ seed '
const SOLE_MEMBER = 1

interface RepoPorts {
	name: string
	// `undefined` when the repository's `.env` holds a malformed seed — reported rather than guessed.
	seed: number | undefined
	development: number | undefined
	preview: number | undefined
}

interface SharedSeed {
	seed: number
	names: Array<string>
}

// A repository is read at its main work tree (seat 0), so the ports reported are the ones it runs on
// without a lane open, computed from the seed alone — a root `.env` should carry no `JOSH_LANE_SEAT`,
// and honoring a stray one would move the reported ports off the main tree and hide a valid seed
// behind a malformed seat. A missing `.env` is the common case — the unset seed CI and un-migrated
// consumers use — and reads as seed 0; a malformed seed is caught and reported unreadable, naming
// the one key that is actually wrong.
function read_repository_ports(name: string, repository_path: string): RepoPorts {
	const file = path.join(repository_path, ENV_FILE_NAME)
	const content = existsSync(file) ? readFileSync(file, 'utf8') : ''

	try {
		const seed = lane_environment.read_root_seed(content)
		const environment = { [PORT_SEED_KEY]: String(seed) }

		return {
			name,
			seed,
			development: ports.resolve_development_port(environment),
			preview: ports.resolve_preview_port(environment),
		}
	} catch {
		return { name, seed: undefined, development: undefined, preview: undefined }
	}
}

function format_row(entry: RepoPorts): string {
	if (entry.seed === undefined) return `${ROW_INDENT}${entry.name}${COLUMN_SEPARATOR}${UNREADABLE}`

	const columns = `seed ${String(entry.seed)}${COLUMN_SEPARATOR}dev ${String(entry.development)}${COLUMN_SEPARATOR}preview ${String(entry.preview)}`

	return `${ROW_INDENT}${entry.name}${COLUMN_SEPARATOR}${columns}`
}

function group_by_seed(entries: ReadonlyArray<RepoPorts>): Map<number, Array<string>> {
	const by_seed = new Map<number, Array<string>>()

	for (const { name, seed } of entries) {
		if (seed === undefined) continue
		by_seed.set(seed, [...(by_seed.get(seed) ?? []), name])
	}

	return by_seed
}

// Only seeds held by more than one repository are a clash worth naming.
function shared_seeds(entries: ReadonlyArray<RepoPorts>): Array<SharedSeed> {
	return [...group_by_seed(entries)]
		.filter(([, names]) => names.length > SOLE_MEMBER)
		.map(([seed, names]) => ({ seed, names }))
		.toSorted((left, right) => left.seed - right.seed)
}

function format_shared(shared: ReadonlyArray<SharedSeed>): Array<string> {
	return shared.map(
		({ seed, names }) => `${SHARED_PREFIX}${String(seed)} is shared by: ${names.join(', ')}`,
	)
}

function format_port_report(entries: ReadonlyArray<RepoPorts>): string {
	const rows = entries.map((entry) => format_row(entry))
	const shared = format_shared(shared_seeds(entries))

	return [HEADING, ...rows, ...shared].join('\n')
}

// The map is `owner/repo` → absolute path; the rows are sorted by name so the report is stable.
function report_port_seeds(map: ReadonlyMap<string, string>): string {
	const entries = [...map]
		.toSorted(([left], [right]) => left.localeCompare(right))
		.map(([name, repository_path]) => read_repository_ports(name, repository_path))

	return format_port_report(entries)
}

const doctor_ports = {
	format_port_report,
	read_repository_ports,
	report_port_seeds,
	shared_seeds,
}

export type { RepoPorts as RepositoryPorts }
export { doctor_ports }
