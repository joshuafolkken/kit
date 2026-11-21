import { latest_regression, type VersionRegression } from './latest-regression'

// The minimum-age gate also hides a fresh stable major while an older prerelease of it has aged
// past the gate; `--latest` then moves a stable range onto that prerelease (joshuafolkken/kit#7693).
// Unlike a downgrade, the stable range stays resolvable — its installed version is still allowed —
// so only that entry is put back and the rest of the update stands. Rolling everything back instead
// would block every update for as long as a package's `latest` tag points at a prerelease.

function is_new_prerelease(before_range: string, after_range: string | undefined): boolean {
	const before = latest_regression.to_floor(before_range)
	const after = latest_regression.to_floor(after_range)

	if (before === undefined || after === undefined) return false

	return before.prerelease.length === 0 && after.prerelease.length > 0
}

/** Report every direct dependency whose stable range the update moved onto a prerelease. */
function find_new_prereleases(
	before_content: string,
	after_content: string,
): Array<VersionRegression> {
	const before = latest_regression.read_direct_dependencies(before_content)
	const after = latest_regression.read_direct_dependencies(after_content)

	return Object.entries(before)
		.filter(([name, range]) => is_new_prerelease(range, after[name]))
		.map(([name, range]) => ({ name, kept: range, offered: after[name] ?? '' }))
}

// A text replacement rather than a JSON round-trip, so the rest of the manifest keeps its layout.
function entry_text(name: string, range: string): string {
	return `${JSON.stringify(name)}: ${JSON.stringify(range)}`
}

/** Put each kept entry's stable range back into the manifest text. */
function with_stable_ranges(content: string, kept: ReadonlyArray<VersionRegression>): string {
	let text = content

	for (const entry of kept) {
		text = text
			.split(entry_text(entry.name, entry.offered))
			.join(entry_text(entry.name, entry.kept))
	}

	return text
}

function format_entry(entry: VersionRegression): string {
	return `${entry.name}@${entry.kept} (newest allowed is the prerelease ${entry.offered})`
}

function format_stable_kept_notice(kept: ReadonlyArray<VersionRegression>): string {
	const list = kept.map((entry) => format_entry(entry)).join(', ')

	return [
		`\n⏮ Keeping ${list} on its stable range — a stable range never moves onto a prerelease.`,
		'   The rest of the update went through. A later run moves it once a stable release is allowed.',
	].join('\n')
}

const latest_prerelease = {
	find_new_prereleases,
	with_stable_ranges,
	format_stable_kept_notice,
}

export { latest_prerelease }
