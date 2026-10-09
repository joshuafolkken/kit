import { createHash } from 'node:crypto'
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { json_value } from '#scripts/lib/json-value'

// What a hook build was made from, so a later launch can tell whether `dist/hooks/` still matches the
// source it runs beside. `dist/` is git-ignored and rebuilt only by
// `pnpm build`, so without this record an edited guard keeps running its old bundle with nothing to
// say so — and a lane's bundles are copied from the main checkout, whose source can differ.
//
// **The record is a content digest, not a timestamp.** A copy (`lane-cache.ts`) or a fresh checkout
// rewrites every mtime while leaving the content alone, and a digest is the only comparison that
// neither rebuilds on that nor misses an edit that kept the old mtime. The mtime memory below only
// decides when the digest is recomputed, never what it is compared against.
//
// **The digest is taken from the bytes the build read, never re-read from disk afterwards.** A source
// edited while the build runs would otherwise be recorded as built, and its stale bundle read as fresh.
//
// **A verified digest is remembered by each input's mtime and size**. Hashing
// every input on every hook launch is the gate's whole cost, so once the digest has matched, the
// inputs' signatures are written beside the stamp and a later launch whose signatures all match skips
// the hash. The digest stays the record: a copied or checked-out tree matches no remembered signature
// and is hashed once, then remembered. Each signature is taken before its input is read, so an edit
// landing during the hash leaves a signature that no longer matches. The memory is a separate file
// rather than a rewrite of the stamp, so a launch never races the build that owns the stamp, and the
// build's prune drops it with the outputs it vouched for.
//
// **Nothing is remembered while an input's mtime is still within the timestamp granularity of now.**
// On a coarse-mtime volume (HFS+ 1 s, FAT/exFAT 2 s) a same-size edit landing in the tick the
// signature was taken in keeps that signature, so it would be remembered as verified and never hashed
// again. Once an mtime is older than the window any later write moves it, so only settled inputs are
// remembered; a launch inside the window simply hashes.
//
// This module is loaded by plain `node` on every hook launch (`scripts/hooks/hook-bundle-ready.ts`),
// so it imports `node:` built-ins and `#scripts/*` subpaths alone — nothing slow to load.

const STAMP_NAME = 'inputs.json'
const VERIFIED_NAME = '.inputs-verified.json'
const DIGEST_ALGORITHM = 'sha256'
const JSON_INDENT = '\t'
// The coarsest mtime resolution a remembered signature has to outlast (FAT/exFAT).
const MTIME_GRANULARITY_MS = 2000

interface HookBundleStamp {
	digest: string
	inputs: Array<string>
	outputs: Array<string>
}

// Package-relative input path → the bytes the build read for it.
type HookSources = ReadonlyMap<string, Uint8Array>

// Package-relative input path → `<mtimeMs>:<size>`, as it stood when its bytes were hashed.
type InputSignatures = Record<string, string>

interface InputSnapshot {
	signatures: InputSignatures
	// False while any input's mtime is too recent to tell a later edit in the same tick apart.
	is_settled: boolean
}

interface VerifiedDigest {
	digest: string
	signatures: InputSignatures
}

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

// Undefined when an input is gone, like `read_sources`.
function read_snapshot(
	package_directory: string,
	inputs: ReadonlyArray<string>,
): InputSnapshot | undefined {
	const signatures: InputSignatures = {}
	const settled_before = Date.now() - MTIME_GRANULARITY_MS
	let is_settled = true

	for (const input of inputs) {
		const stats = statSync(path.join(package_directory, input), { throwIfNoEntry: false })
		if (stats === undefined) return undefined
		signatures[input] = `${String(stats.mtimeMs)}:${String(stats.size)}`
		is_settled &&= stats.mtimeMs < settled_before
	}

	return { signatures, is_settled }
}

function read_verified(out_directory: string): Record<string, unknown> | undefined {
	const verified_path = path.join(out_directory, VERIFIED_NAME)
	if (!existsSync(verified_path)) return undefined
	const verified = json_value.parse_or_undefined(readFileSync(verified_path, 'utf8'))

	return json_value.is_record(verified) ? verified : undefined
}

// True when `digest` was verified against inputs whose signatures are all still `signatures`.
function is_remembered(
	out_directory: string,
	digest: string,
	signatures: InputSignatures,
): boolean {
	const verified = read_verified(out_directory)
	const remembered = verified?.['signatures']
	if (verified?.['digest'] !== digest || !json_value.is_record(remembered)) return false

	return Object.keys(signatures).every((input) => remembered[input] === signatures[input])
}

// Written through a rename so a concurrent launch never reads half a record. Best-effort: a tree that
// cannot be written is simply hashed again next time.
function remember(out_directory: string, verified: VerifiedDigest): void {
	const temporary_path = path.join(out_directory, `${VERIFIED_NAME}.${String(process.pid)}`)

	try {
		writeFileSync(temporary_path, JSON.stringify(verified))
		renameSync(temporary_path, path.join(out_directory, VERIFIED_NAME))
	} catch {
		rmSync(temporary_path, { force: true })
	}
}

function is_digest_current(
	out_directory: string,
	package_directory: string,
	stamp: HookBundleStamp,
	{ signatures, is_settled }: InputSnapshot,
): boolean {
	const sources = read_sources(package_directory, stamp.inputs)
	if (sources === undefined || digest_of(sources) !== stamp.digest) return false
	if (is_settled) remember(out_directory, { digest: stamp.digest, signatures })

	return true
}

// Fresh only when the record exists, every output it lists is still there, and the listed inputs hash
// to the recorded digest — a missing or deleted input counts as stale. The hash is skipped when the
// inputs still carry the signatures of an earlier launch that verified this digest.
function is_fresh(out_directory: string, package_directory: string): boolean {
	const stamp = read_stamp(out_directory)
	if (!stamp?.outputs.every((output) => existsSync(path.join(out_directory, output)))) return false
	const snapshot = read_snapshot(package_directory, stamp.inputs)
	if (snapshot === undefined) return false
	if (is_remembered(out_directory, stamp.digest, snapshot.signatures)) return true

	return is_digest_current(out_directory, package_directory, stamp, snapshot)
}

const hook_bundle_stamp = { is_fresh, STAMP_NAME, stamp_text, VERIFIED_NAME }

export type { HookSources }
export { hook_bundle_stamp }
