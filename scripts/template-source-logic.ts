import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { z } from 'zod'
import { package_path } from './init-paths'

interface TemplateSourcePair {
	template: string
	source: string
}

// Internal maintainer guard state. Kept at the repo root (not under templates/)
// so it is NOT distributed to consumers via the package `files` field, matching
// the .overrides-snapshot.json convention. Holds tripwire-pair hashes only.
const MANIFEST_PATH = '.template-source-manifest.json'

// Copy pairs: the template is a byte-for-byte copy of the root source (no
// intentional divergence). `reconcile` regenerates the copy; the parity test
// asserts exact equality. npm strips a literal `.gitignore` from the package,
// so the dotless `templates/gitignore` remains the distribution vehicle.
const COPY_PAIRS: ReadonlyArray<TemplateSourcePair> = [
	{ template: 'templates/gitignore', source: '.gitignore' },
]

// Tripwire pairs: the template intentionally diverges from the root source
// (half of past source edits were deliberately not propagated). A source edit
// trips the guard and forces a conscious re-check; propagation stays a human
// decision. When adding a pair to either list, also add its `source` (and, for
// copy pairs, its `template`) to the template-source-parity glob in lefthook.yml.
const TRIPWIRE_PAIRS: ReadonlyArray<TemplateSourcePair> = [
	{ template: 'templates/sonar-project.properties', source: 'sonar-project.properties' },
]

const source_manifest_schema = z.record(z.string(), z.string())

type SourceManifest = z.infer<typeof source_manifest_schema>

function read_file(relative_path: string): string {
	return readFileSync(package_path(relative_path), 'utf8')
}

function read_optional_file(relative_path: string): string {
	const full_path = package_path(relative_path)

	return existsSync(full_path) ? readFileSync(full_path, 'utf8') : ''
}

function hash_text(text: string): string {
	return createHash('sha256').update(text).digest('hex')
}

function find_copy_drift(): Array<TemplateSourcePair> {
	return COPY_PAIRS.filter((pair) => read_optional_file(pair.template) !== read_file(pair.source))
}

function build_tripwire_manifest(): SourceManifest {
	const manifest: SourceManifest = {}

	for (const pair of TRIPWIRE_PAIRS) {
		manifest[pair.source] = hash_text(read_file(pair.source))
	}

	return manifest
}

function find_tripwire_drift(recorded: SourceManifest): Array<TemplateSourcePair> {
	return TRIPWIRE_PAIRS.filter(
		(pair) => recorded[pair.source] !== hash_text(read_file(pair.source)),
	)
}

function read_recorded_manifest(): SourceManifest {
	return source_manifest_schema.parse(JSON.parse(read_file(MANIFEST_PATH)))
}

function format_drift_message(
	copy_drift: ReadonlyArray<TemplateSourcePair>,
	tripwire_drift: ReadonlyArray<TemplateSourcePair>,
): string {
	const lines = [
		...copy_drift.map((pair) => `  - ${pair.template} is out of date with ${pair.source}`),
		...tripwire_drift.map((pair) => `  - ${pair.source} changed → review ${pair.template}`),
	]

	return [
		'✖ Template source(s) need reconciling:',
		...lines,
		'  Review any tripwire template, then run `pnpm josh reconcile-templates`.',
	].join('\n')
}

function regenerate_copies(): void {
	for (const pair of COPY_PAIRS) {
		copyFileSync(package_path(pair.source), package_path(pair.template))
	}
}

function write_tripwire_manifest(): void {
	const serialized = `${JSON.stringify(build_tripwire_manifest(), undefined, '\t')}\n`

	writeFileSync(package_path(MANIFEST_PATH), serialized)
}

function reconcile(): void {
	regenerate_copies()
	write_tripwire_manifest()
}

const template_source_logic = {
	MANIFEST_PATH,
	COPY_PAIRS,
	TRIPWIRE_PAIRS,
	hash_text,
	find_copy_drift,
	build_tripwire_manifest,
	find_tripwire_drift,
	read_recorded_manifest,
	format_drift_message,
	reconcile,
}

export { template_source_logic, source_manifest_schema }
export type { SourceManifest, TemplateSourcePair }
