// Grouping fingerprints into clones, and classifying how far each clone spans (joshuafolkken/kit#2217).
//
// This is the pure core the `no-clones` rule was missing a measurement for: `sonarjs/no-identical-
// functions` sees only inside one file, and the rule's real target is duplication that crosses file
// and package boundaries. Here a clone is a fingerprint that occurs at two or more sites, and its
// category is the widest boundary any two of those sites straddle.

// One fingerprint occurrence: the hash of a normalized code window and where it was found.
interface Fingerprint {
	hash: string
	site: CloneSite
}

// Where a fingerprint occurs. `repo` is the identity duplication is measured against — two sites in
// different repositories are a cross-repository clone however identical their relative paths look.
interface CloneSite {
	repo: string
	file: string
	line: number
}

// How far a clone spans. `same-file` is the narrowest, `cross-repo` the widest.
type CloneCategory = 'same-file' | 'cross-file' | 'cross-repo'

// A fingerprint that duplicated, its sites, and the boundary it crosses.
interface CloneGroup {
	hash: string
	sites: ReadonlyArray<CloneSite>
	category: CloneCategory
}

// A fingerprint is a clone only once it occurs at least twice.
const MIN_SITES = 2

// The widest boundary any two of the sites straddle: a second repository first, then a second file,
// else the sites share one file.
function categorize(sites: ReadonlyArray<CloneSite>): CloneCategory {
	const repos = new Set(sites.map((site) => site.repo))
	if (repos.size > 1) return 'cross-repo'

	const files = new Set(sites.map((site) => site.file))
	if (files.size > 1) return 'cross-file'

	return 'same-file'
}

// Every site collected under its fingerprint hash, insertion order preserved.
function group_sites(fingerprints: ReadonlyArray<Fingerprint>): Map<string, Array<CloneSite>> {
	const groups = new Map<string, Array<CloneSite>>()

	for (const fingerprint of fingerprints) {
		const sites = groups.get(fingerprint.hash) ?? []

		sites.push(fingerprint.site)
		groups.set(fingerprint.hash, sites)
	}

	return groups
}

// The clones among the fingerprints — those occurring at two or more sites — each classified. The
// count a caller reports is the length of this array.
function aggregate(fingerprints: ReadonlyArray<Fingerprint>): Array<CloneGroup> {
	const clones: Array<CloneGroup> = []

	for (const [hash, sites] of group_sites(fingerprints)) {
		if (sites.length >= MIN_SITES) clones.push({ hash, sites, category: categorize(sites) })
	}

	return clones
}

const clone_aggregate = { categorize, aggregate }

export type { CloneCategory, CloneSite, Fingerprint, CloneGroup }
export { clone_aggregate }
