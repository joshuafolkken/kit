import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { PROBE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { lane_paths } from './lane-paths'

// Each process's working directory, read with `lsof` — the one place its output is parsed.
//
// **A process belongs to a lane by its working directory first, its ancestry only after.** A process
// detached from a lane (`josh ship --detach`, a diagnostic started under `script`) is re-parented to
// pid 1, so no parent chain reaches it, while its working directory still sits under `.kit-lanes/<N>`.
// `run:board` draws such a process as a lane's or a leftover, and `lane:close` ends it
// (joshuafolkken/kit#4304); the board falls back to the ancestry where the directory names no lane
// (`run-board-usage-lanes.ts`).
// **macOS alone**, as the board reads it: elsewhere nothing is listed.

const LSOF_COMMAND = 'lsof'
// `-a` joins the conditions: the `cwd` descriptor only, in `-F` fields. The board appends `-p <pids>`.
const CWD_ARGUMENTS = ['-a', '-d', 'cwd', '-Fn']
// `lsof -F`'s field lines: `p<pid>` opens a process, `n<path>` names its directory.
const LSOF_PROCESS = /^(?=p)/mu
const LSOF_NAME = 'n'
const LISTING_PLATFORMS: ReadonlySet<NodeJS.Platform> = new Set(['darwin'])

function lsof_block(block: string): [number, string] | undefined {
	const [process_line = '', ...rest] = block.trim().split('\n')
	const name = rest.find((line) => line.startsWith(LSOF_NAME))

	return name === undefined ? undefined : [Number(process_line.slice(1)), name.slice(1)]
}

/** Each process's working directory from `lsof -F`'s output. */
function parse(output: string): Map<number, string> {
	const blocks = output.split(LSOF_PROCESS).map((block) => lsof_block(block))

	return new Map(blocks.filter((block) => block !== undefined))
}

/**
 * Every process's working directory, `undefined` where `lsof` could not be run or timed out — never
 * read as "nothing there". `lsof` exits non-zero when one process cannot be read and still lists the
 * rest, so its output is read whatever the exit status.
 */
function list_all(platform: NodeJS.Platform = process.platform): Map<number, string> | undefined {
	if (!LISTING_PLATFORMS.has(platform)) return new Map()

	const result = spawnSync(LSOF_COMMAND, CWD_ARGUMENTS, {
		encoding: 'utf8',
		timeout: PROBE_TIMEOUT_MS,
		stdio: ['ignore', 'pipe', 'ignore'],
	})

	return result.error === undefined ? parse(result.stdout) : undefined
}

/**
 * The lane of `root` a directory sits under — itself or a directory above it, the outermost first.
 * The one lane-membership reading: the board draws a leftover by it, and the close ends by it
 * (joshuafolkken/kit#4300).
 */
function lane_of(directory: string, root: string): string | undefined {
	const parts = directory.split(path.sep)
	const ancestors = parts.map((_, index) => parts.slice(0, index + 1).join(path.sep)).slice(1)
	const environment = { [lane_paths.LANE_ROOT_KEY]: root }

	return ancestors.map((ancestor) => lane_paths.lane_issue_of(ancestor, environment)).find(Boolean)
}

const process_directories = { CWD_ARGUMENTS, lane_of, list_all, parse }

export { process_directories }
