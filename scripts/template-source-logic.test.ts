import { describe, expect, it } from 'vitest'
import {
	template_source_logic,
	type SourceManifest,
	type TemplateSourcePair,
} from './template-source-logic'

const { hash_text, build_manifest, find_drifted_pairs, format_drift_message } =
	template_source_logic
const TRACKED_PAIRS: ReadonlyArray<TemplateSourcePair> = template_source_logic.TEMPLATE_SOURCE_PAIRS

// Build a manifest keyed by the real tracked sources, one hash per source, so
// tests never need dotted object-literal keys (which violate naming-convention).
function manifest_from(hashes: ReadonlyArray<string>): SourceManifest {
	const manifest: SourceManifest = {}

	for (const [index, pair] of TRACKED_PAIRS.entries()) {
		manifest[pair.source] = hashes[index] ?? ''
	}

	return manifest
}

function first_pair(): TemplateSourcePair {
	const [pair] = TRACKED_PAIRS
	if (!pair) throw new Error('TEMPLATE_SOURCE_PAIRS must not be empty')

	return pair
}

describe('template_source_logic.hash_text', () => {
	it('is deterministic for the same input', () => {
		expect(hash_text('abc')).toBe(hash_text('abc'))
	})

	it('changes when the input changes', () => {
		expect(hash_text('abc')).not.toBe(hash_text('abcd'))
	})
})

describe('template_source_logic.build_manifest', () => {
	it('maps each source to the hash of its content', () => {
		const manifest = build_manifest(manifest_from(['node_modules\n']))

		expect(manifest[first_pair().source]).toBe(hash_text('node_modules\n'))
	})
})

describe('template_source_logic.find_drifted_pairs', () => {
	it('returns nothing when recorded and current hashes match', () => {
		const current = manifest_from(['x', 'y'])

		expect(find_drifted_pairs(current, current)).toEqual([])
	})

	it('returns only the pair whose source hash diverged', () => {
		const recorded = manifest_from(['x', 'y'])
		const current = manifest_from(['CHANGED', 'y'])
		const drifted = find_drifted_pairs(recorded, current)

		expect(drifted.map((pair) => pair.source)).toEqual([first_pair().source])
	})

	it('treats a source missing from the recorded manifest as drift', () => {
		const current = manifest_from(['x', 'y'])

		expect(find_drifted_pairs({}, current)).toHaveLength(TRACKED_PAIRS.length)
	})
})

describe('template_source_logic.format_drift_message', () => {
	it('names each drifted source and its paired template', () => {
		const pair = first_pair()
		const message = format_drift_message([pair])

		expect(message).toContain(`${pair.source} changed → review ${pair.template}`)
		expect(message).toContain('pnpm josh reconcile-templates')
	})
})
