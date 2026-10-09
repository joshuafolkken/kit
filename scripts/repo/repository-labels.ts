import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { REPOSITORY_LABELS, type LabelDefinition } from '#scripts/issue/issue-labels'

// Creates the labels kit's workflow and the distributed `pr-classification.yml` rely on, and only
// those the repository is missing. The one place labels are created: `josh
// start` provisions a new repository through it and `josh sync` brings every existing one up to date.
//
// Labels already present are left as they are, so a repository that recolored one keeps its choice
// and a second run changes nothing. GitHub compares label names case-insensitively.
//
// **Never throws.** A token without the scope or no network must not stop a sync halfway; the names
// still missing are printed instead, so the person can create them by hand.

function labels_endpoint(repo: string): string {
	return `repos/${repo}/labels`
}

// A failed request is an answer to report, never an exception to propagate (see above).
function request(api: Parameters<typeof git_gh_exec.exec_gh_api_sync>[0]): string | undefined {
	try {
		return git_gh_exec.exec_gh_api_sync(api)
	} catch {
		return undefined
	}
}

function read_existing(repo: string): ReadonlyArray<string> | undefined {
	const path = labels_endpoint(repo)
	const listing = request({ path, should_paginate: true, jq_filter: '.[].name' })

	return listing?.split('\n').filter((name) => name.length > 0)
}

function missing_labels(existing: ReadonlyArray<string>): ReadonlyArray<LabelDefinition> {
	const names = new Set(existing.map((name) => name.toLowerCase()))

	return REPOSITORY_LABELS.filter((label) => !names.has(label.name.toLowerCase()))
}

function create_label(label: LabelDefinition, repo: string): boolean {
	const body = JSON.stringify(label)
	const is_created = request({ path: labels_endpoint(repo), method: 'POST', body }) !== undefined

	if (is_created) console.info(`  ✔ label ${label.name}`)

	return is_created
}

function label_names(labels: ReadonlyArray<LabelDefinition>): ReadonlyArray<string> {
	return labels.map((label) => label.name)
}

// An unreadable listing is not an empty one: nothing is created, and every label is reported as
// unconfirmed rather than as missing. An unresolved repository (no GitHub remote) is the same case.
function unreadable(repo: string | undefined = 'this repository'): ReadonlyArray<string> {
	const names = label_names(REPOSITORY_LABELS)
	const target = repo

	console.warn(
		`  ⚠ could not read the labels of ${target}; make sure these exist: ${names.join(', ')}`,
	)

	return names
}

function create_missing(
	missing: ReadonlyArray<LabelDefinition>,
	repo: string,
): ReadonlyArray<string> {
	const names = label_names(missing.filter((label) => !create_label(label, repo)))

	if (names.length > 0) {
		console.warn(`  ⚠ could not create these labels; create them by hand: ${names.join(', ')}`)
	}

	return names
}

// The label names not confirmed present afterwards — empty when the repository has every one.
function ensure_labels(repo: string | undefined): ReadonlyArray<string> {
	if (repo === undefined) return unreadable(repo)

	const existing = read_existing(repo)
	if (existing === undefined) return unreadable(repo)

	return create_missing(missing_labels(existing), repo)
}

const repository_labels = { ensure_labels }

export { repository_labels }
