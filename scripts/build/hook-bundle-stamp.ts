import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { json_value } from '#scripts/lib/json-value'

// What a hook build was made from, so a later launch can tell whether `dist/hooks/` still matches the
// source it runs beside (joshuafolkken/kit#2984). `dist/` is git-ignored and rebuilt only by
// `pnpm build`, so without this record an edited guard keeps running its old bundle with nothing to
// say so — and a lane's bundles are copied from the main checkout, whose source can differ.
//
// **The record is a content digest, not a timestamp.** A copy (`lane-cache.ts`) or a fresh checkout
// rewrites every mtime while leaving the content alone, and a digest is the only comparison that
// neither rebuilds on that nor misses an edit that kept the old mtime.
//
// **The digest is taken from the bytes the build read, never re-read from disk afterwards.** A source
// edited while the build runs would otherwise be recorded as built, and its stale bundle read as fresh.
//
// This module is loaded by plain `node` on every hook launch (`scripts/hooks/hook-bundle-ready.ts`),
// so it imports `node:` built-ins and `#scripts/*` subpaths alone — nothing slow to load.

const STAMP_NAME = 'inputs.json'
const DIGEST_ALGORITHM = 'sha256'
const JSON_INDENT = '\t'

interface HookBundleStamp {
	digest: string
	inputs: Array<string>
	outputs: Array<string>
}

// Package-relative input path → the bytes the build read for it.
type HookSources = ReadonlyMap<string, Uint8Array>

// Code-unit order, so the digest does not depend on the locale of the machine that computes it.
function by_code_unit(left: string, right: string): number {
	if (left === right) return 0

	return left < right ? -1 : 1
}

// Inputs are hashed in sorted order with their names, so a rename or a reorder changes the digest.
function digest_of(sources: HookSources): string {
	const hash = createHash(DIGEST_ALGORITHM)

	for (const input of [...sources.keys()].toSorted(by_code_unit)) {
		hash.update(`${input}\0`).update(sources.get(input) ?? new Uint8Array())
	}

	return hash.digest('hex')
}

// The record for a build that read `sources` and emitted `outputs`, as the text to write.
function stamp_text(sources: HookSources, outputs: ReadonlyArray<string>): string {
	const stamp: HookBundleStamp = {
		digest: digest_of(sources),
		inputs: [...sources.keys()],
		outputs: outputs.map((output) => path.basename(output)),
	}

	return `${JSON.stringify(stamp, undefined, JSON_INDENT)}\n`
}

// Undefined when an input is gone: a deleted input cannot match any digest.
function read_sources(
	package_directory: string,
	inputs: ReadonlyArray<string>,
): HookSources | undefined {
	const sources = new Map<string, Uint8Array>()

	for (const input of inputs) {
		const file_path = path.join(package_directory, input)
		if (!existsSync(file_path)) return undefined
		sources.set(input, readFileSync(file_path))
	}

	return sources
}

function is_string_array(value: unknown): value is Array<string> {
	return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function is_stamp(value: unknown): value is HookBundleStamp {
	if (!json_value.is_record(value) || typeof value['digest'] !== 'string') return false

	return is_string_array(value['inputs']) && is_string_array(value['outputs'])
}

// A record of any other shape — hand-edited, truncated, or from an older format — reads as no record.
function read_stamp(out_directory: string): HookBundleStamp | undefined {
	const stamp_path = path.join(out_directory, STAMP_NAME)
	if (!existsSync(stamp_path)) return undefined
	const stamp = json_value.parse_or_undefined(readFileSync(stamp_path, 'utf8'))

	return is_stamp(stamp) ? stamp : undefined
}

// Fresh only when the record exists, every output it lists is still there, and the listed inputs hash
// to the recorded digest — a missing or deleted input counts as stale.
function is_fresh(out_directory: string, package_directory: string): boolean {
	const stamp = read_stamp(out_directory)
	if (!stamp?.outputs.every((output) => existsSync(path.join(out_directory, output)))) return false
	const sources = read_sources(package_directory, stamp.inputs)

	return sources !== undefined && digest_of(sources) === stamp.digest
}

const hook_bundle_stamp = { is_fresh, STAMP_NAME, stamp_text }

export type { HookSources }
export { hook_bundle_stamp }
