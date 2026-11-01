import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

// The filings `josh issue:file --batch <dir>` reads: every `*.md` body file in the directory, in name
// order. A body's title is its front matter's `title:` line, else its first line (a leading `#`
// heading marker dropped); a front matter `distinct: <N,…>` line is that filing's `--distinct`.

interface BatchEntry {
	source: string
	title: string
	body: string
	distinct: string | undefined
}

interface Split {
	fields: ReadonlyMap<string, string>
	rest: string
}

const FRONT_MATTER = /^---\n(?<block>[\s\S]*?)\n---\n/u
const HEADING_MARKER = /^#+\s*/u
const BODY_EXTENSION = '.md'
const FIELD_SEPARATOR = ':'

function fields_of(block: string): ReadonlyMap<string, string> {
	const fields = new Map<string, string>()

	for (const line of block.split('\n')) {
		const index = line.indexOf(FIELD_SEPARATOR)

		if (index > 0) fields.set(line.slice(0, index).trim(), line.slice(index + 1).trim())
	}

	return fields
}

function split_front_matter(text: string): Split {
	const match = FRONT_MATTER.exec(text)

	if (match === null) return { fields: new Map(), rest: text }

	return { fields: fields_of(match.groups?.['block'] ?? ''), rest: text.slice(match[0].length) }
}

function entry_of(text: string, source: string): BatchEntry {
	const { fields, rest } = split_front_matter(text.trimStart())
	const distinct = fields.get('distinct')
	const title = fields.get('title')

	if (title !== undefined) return { source, title, body: rest.trimStart(), distinct }
	const [first = '', ...remaining] = rest.split('\n')

	return {
		source,
		title: first.replace(HEADING_MARKER, '').trim(),
		body: remaining.join('\n').trimStart(),
		distinct,
	}
}

async function entries_of(directory: string): Promise<ReadonlyArray<BatchEntry>> {
	const listing = await readdir(directory)
	const names = listing
		.filter((name) => name.endsWith(BODY_EXTENSION))
		.toSorted((left, right) => left.localeCompare(right))

	return await Promise.all(
		names.map(async (name) => {
			const source = path.join(directory, name)

			return entry_of(await readFile(source, 'utf8'), source)
		}),
	)
}

const issue_file_batch_entries = { entries_of, entry_of }

export { issue_file_batch_entries }
export type { BatchEntry }
