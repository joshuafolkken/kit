import { json_format } from '#scripts/config-merge/json-format'
import { json_value } from '#scripts/lib/json-value'
import { KIT_PACKAGE_NAME } from '#scripts/version/kit-descriptor'

// One file kit writes into a project, with the content it writes there. `distributed` is absent when
// that content cannot be worked out here — a file whose text depends on the repository it lands in,
// read where there is no such repository — and such a file is never one this command may delete.
interface DistributedFile {
	dest: string
	distributed: string | undefined
}

interface FilePlan {
	remove: Array<string>
	keep: Array<string>
}

type ReadFile = (destination: string) => string | undefined

// Never deleted, even while it is still what kit wrote: without it the `.env` and `node_modules` it
// kept out of Git turn into untracked files, and the next `git add -A` stages them.
const IGNORE_FILE = '.gitignore'
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies']
const JOSH_FIELD = 'josh'
const PROFILE_FIELD = 'profile'
// `strip_kit` takes kit's own entry back out of this field, so it is not left for a person to review.
const HANDLED_FIELDS: ReadonlySet<string> = new Set([JOSH_FIELD])

// A file is deleted only while it is still, byte for byte, what kit writes: anything else holds the
// project's own lines — an edit, or a file kit merged its entries into — and kit kept no record of
// which lines those are.
function classify_files(files: ReadonlyArray<DistributedFile>, read_file: ReadFile): FilePlan {
	const present = files
		.map((file) => ({ ...file, existing: read_file(file.dest) }))
		.filter((file) => file.existing !== undefined)
	const untouched = new Set(
		present.filter((file) => file.existing === file.distributed).map((file) => file.dest),
	)
	const destinations = [...new Set(present.map((file) => file.dest))]

	return {
		remove: destinations.filter((destination) => untouched.has(destination)),
		keep: destinations.filter((destination) => !untouched.has(destination)),
	}
}

function parse_manifest(manifest_text: string): Record<string, unknown> {
	const parsed: unknown = JSON.parse(manifest_text)

	if (!json_value.is_record(parsed)) throw new Error('package.json must contain an object')

	return parsed
}

function without_key(record: Record<string, unknown>, key: string): Record<string, unknown> {
	return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key))
}

// The field with one key taken out of the object it holds — and the field itself once that leaves
// the object empty, so a manifest kit created is not left carrying `"devDependencies": {}`.
function without_nested_key(
	manifest: Record<string, unknown>,
	field: string,
	key: string,
): Record<string, unknown> {
	const value = manifest[field]
	if (!json_value.is_record(value) || !Object.hasOwn(value, key)) return manifest
	const rest = without_key(value, key)

	return Object.keys(rest).length === 0
		? without_key(manifest, field)
		: { ...manifest, [field]: rest }
}

// The manifest without kit's dependency entry and its profile record — the two entries that are
// kit's alone, so removing them cannot take anything of the project's.
function strip_kit(manifest_text: string): string {
	let manifest = without_nested_key(parse_manifest(manifest_text), JOSH_FIELD, PROFILE_FIELD)

	for (const field of DEPENDENCY_FIELDS) {
		manifest = without_nested_key(manifest, field, KIT_PACKAGE_NAME)
	}

	return json_format.format_package_json(manifest)
}

// Whether the manifest still holds an entry `strip_kit` takes out — asked of the parsed manifest, so
// a file indented another way is not mistaken for one that has something to remove.
function has_kit_entries(manifest_text: string): boolean {
	const unchanged = json_format.format_package_json(parse_manifest(manifest_text))

	return strip_kit(manifest_text) !== unchanged
}

function shared_entries(field: string, kit_value: unknown, project_value: unknown): Array<string> {
	if (project_value === undefined) return []
	if (!json_value.is_record(kit_value) || !json_value.is_record(project_value)) return [field]

	return Object.keys(kit_value)
		.filter((key) => key !== KIT_PACKAGE_NAME && Object.hasOwn(project_value, key))
		.map((key) => `${field}.${key}`)
}

// The manifest entries kit merges in that the project still holds, named `scripts.preinstall` style.
// `kit_manifest_text` is what kit's own merge writes into an empty manifest, so the names come from
// the merge and not from a second list of them. They are reported, never removed: the merge kept no
// record of the value it found, so a script named `josh` may be kit's or the project's own.
function manifest_review(manifest_text: string, kit_manifest_text: string): Array<string> {
	const manifest = parse_manifest(manifest_text)

	return Object.entries(parse_manifest(kit_manifest_text))
		.filter(([field]) => !HANDLED_FIELDS.has(field))
		.flatMap(([field, kit_value]) => shared_entries(field, kit_value, manifest[field]))
}

const uninstall_plan = { classify_files, strip_kit, has_kit_entries, manifest_review }

export { uninstall_plan, IGNORE_FILE }
export type { DistributedFile, FilePlan }
