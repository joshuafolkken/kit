import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { json_value } from '#scripts/lib/json-value'

// How many test files a unit run ran, handed from the unit reporter to the caller that named a file to
// receive it — `josh test:related`, which records it beside the scope it handed vitest
// (joshuafolkken/kit#4465). Its own shipped module: the reporter is kit-only and the setup-file list
// names files only, so neither can own a protocol a shipped reader shares.

// Names the file the run's test-file count is written to.
const COUNT_FILE_ENVIRONMENT = 'JOSH_UNIT_COUNT_FILE'

// Best-effort like the ledger: a run is never failed by the file it reports into.
async function write_count(count: number, target: string | undefined): Promise<void> {
	if (target === undefined || target === '') return

	try {
		await writeFile(target, String(count))
	} catch {
		// The caller reads a missing count as unknown.
	}
}

// A missing, empty or non-integer file is an unknown count, never zero.
function read_count(file: string): number | undefined {
	try {
		const text = readFileSync(file, 'utf8').trim()
		const count = Number(text)

		return text !== '' && Number.isSafeInteger(count) ? count : undefined
	} catch {
		return undefined
	}
}

async function write_files(
	files: ReadonlyArray<string>,
	target: string | undefined,
): Promise<void> {
	if (target === undefined || target === '') return

	try {
		await writeFile(`${target}.files`, JSON.stringify(files))
	} catch {
		// Missing evidence cannot authorize reuse.
	}
}

function read_files(target: string): ReadonlyArray<string> {
	try {
		const value = json_value.parse_or_undefined(readFileSync(`${target}.files`, 'utf8'))

		return Array.isArray(value) && value.every((file) => typeof file === 'string') ? value : []
	} catch {
		return []
	}
}

const unit_count_file = { COUNT_FILE_ENVIRONMENT, read_count, read_files, write_count, write_files }

export { unit_count_file }
