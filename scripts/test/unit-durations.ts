import { readFileSync } from 'node:fs'
import path from 'node:path'

// The per-file unit durations the CI shards are balanced by (joshuafolkken/kit#4467), read here so
// the published `josh test:related` can weigh them too (joshuafolkken/kit#5105) — the reporter that
// refreshes the record is kit-only (`tools/test/unit-duration-record.ts`). A project without the
// record reads an empty one.

type Durations = Readonly<Record<string, number>>

const RECORD_FILE = 'tools/test/unit-durations.json'

function parse(text: string): Durations {
	const parsed: unknown = JSON.parse(text)

	if (typeof parsed !== 'object' || parsed === null) return {}

	return Object.fromEntries(
		Object.entries(parsed).filter(
			(entry): entry is [string, number] => typeof entry[1] === 'number',
		),
	)
}

// A missing or unreadable record is an empty one: every file then weighs the same fallback.
function read(root: string): Durations {
	try {
		return parse(readFileSync(path.join(root, RECORD_FILE), 'utf8'))
	} catch {
		return {}
	}
}

const unit_durations = {
	RECORD_FILE,
	parse,
	read,
}

export type { Durations }
export { unit_durations }
