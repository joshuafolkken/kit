// The character cap a Bash result is truncated at, read from the settings file rather than restated
// (joshuafolkken/kit#1797). Every entry-read document is larger than it, so a `cat` of one hands back
// a middle-truncated preview and the file is then read a second time — the two wasted requests #1797
// measured. A number copied into code would be a second declaration of the cap and would drift the
// first time the settings changed; the harness's own default stands in only where the file declares
// nothing. Split out of `entry-read-set.ts` in joshuafolkken/kit#2161 to keep that file under its
// line ceiling.

import path from 'node:path'
import { document_section } from './document-section'

const SETTINGS_FILE = path.join('.claude', 'settings.json')
const HARNESS_DEFAULT_CAP_CHARS = 30_000
const ENV_KEY = 'env'
const CAP_KEY = 'BASH_MAX_OUTPUT_LENGTH'
const NONE = 0

function property_of(value: unknown, key: string): unknown {
	if (typeof value !== 'object' || value === null) return undefined

	return Reflect.get(value, key)
}

// **Parsed as JSON rather than matched in the raw text.** A regular expression takes the first
// occurrence anywhere in the file, so a hook command string naming the variable would win over the
// `env` block — and the report would then mark a file `cat`-able that a `cat` truncates. A file that
// is missing or does not parse answers `undefined` and falls through to the harness default below.
function declared_cap(text: string): unknown {
	try {
		return property_of(property_of(JSON.parse(text), ENV_KEY), CAP_KEY)
	} catch {
		return undefined
	}
}

function bash_output_cap(root: string): number {
	const text = document_section.read_optional(path.join(root, SETTINGS_FILE)) ?? ''
	const chars = Number(declared_cap(text))

	return Number.isSafeInteger(chars) && chars > NONE ? chars : HARNESS_DEFAULT_CAP_CHARS
}

const bash_output_cap_reader = { HARNESS_DEFAULT_CAP_CHARS, bash_output_cap }

export { bash_output_cap_reader }
