import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { z } from 'zod'
import { package_path } from './init-paths'

interface TemplateSourcePair {
	template: string
	source: string
}

// Internal maintainer guard state. Kept at the repo root (not under templates/)
// so it is NOT distributed to consumers via the package `files` field, matching
// the .overrides-snapshot.json convention.
const MANIFEST_PATH = '.template-source-manifest.json'

// Each template is hand-maintained and intentionally diverges from its root
// source (half of past source edits were deliberately not propagated). The
// manifest records the source hash last reviewed, so any later edit to a source
// trips the guard and forces a conscious re-check of the paired template.
// Propagation stays a human decision; only the review is enforced.
//
// When adding a pair here, also add its `source` to the `template-source-parity`
// glob in lefthook.yml so the pre-commit guard fires for it (CI's parity test
// covers every pair regardless).
const TEMPLATE_SOURCE_PAIRS: ReadonlyArray<TemplateSourcePair> = [
	{ template: 'templates/sonar-project.properties', source: 'sonar-project.properties' },
	{ template: 'templates/gitignore', source: '.gitignore' },
]

const source_manifest_schema = z.record(z.string(), z.string())

type SourceManifest = z.infer<typeof source_manifest_schema>

function hash_text(text: string): string {
	return createHash('sha256').update(text).digest('hex')
}

function build_manifest(source_contents: SourceManifest): SourceManifest {
	const manifest: SourceManifest = {}

	for (const [source, content] of Object.entries(source_contents)) {
		manifest[source] = hash_text(content)
	}

	return manifest
}

function find_drifted_pairs(
	recorded: SourceManifest,
	current: SourceManifest,
): Array<TemplateSourcePair> {
	return TEMPLATE_SOURCE_PAIRS.filter((pair) => recorded[pair.source] !== current[pair.source])
}

function format_drift_message(drifted: ReadonlyArray<TemplateSourcePair>): string {
	const lines = drifted.map((pair) => `  - ${pair.source} changed → review ${pair.template}`)

	return [
		'✖ Template source(s) changed since last reconciled:',
		...lines,
		'  Review each paired template, then run `pnpm josh reconcile-templates` to acknowledge.',
	].join('\n')
}

function read_source_contents(): SourceManifest {
	const contents: SourceManifest = {}

	for (const pair of TEMPLATE_SOURCE_PAIRS) {
		contents[pair.source] = readFileSync(package_path(pair.source), 'utf8')
	}

	return contents
}

function compute_current_manifest(): SourceManifest {
	return build_manifest(read_source_contents())
}

function read_recorded_manifest(): SourceManifest {
	return source_manifest_schema.parse(JSON.parse(readFileSync(package_path(MANIFEST_PATH), 'utf8')))
}

function write_recorded_manifest(manifest: SourceManifest): void {
	writeFileSync(package_path(MANIFEST_PATH), `${JSON.stringify(manifest, undefined, '\t')}\n`)
}

const template_source_logic = {
	MANIFEST_PATH,
	TEMPLATE_SOURCE_PAIRS,
	hash_text,
	build_manifest,
	find_drifted_pairs,
	format_drift_message,
	compute_current_manifest,
	read_recorded_manifest,
	write_recorded_manifest,
}

export { template_source_logic, source_manifest_schema }
export type { SourceManifest, TemplateSourcePair }
