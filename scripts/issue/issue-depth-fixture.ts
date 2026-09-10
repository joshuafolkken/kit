import type { DepthCountable } from './issue-depth-share'

// The listing rows both depth suites are written against, built once rather than in each file: the
// two are in the same directory and were added in the same change, so a second spelling of
// `{ name }` here is a clone before it is anything else.

// One issue, as the summary sees it — only the labels are read.
function labelled(...names: Array<string>): DepthCountable {
	return { labels: names.map((name) => ({ name })) }
}

// The same rows as the JSON `issue_list` hands its caller, so a CLI test drives the real parse rather
// than a stub of it. `number`, `title` and `createdAt` are here because `open_issue_schema` requires
// them, not because the share reads them.
function depth_listing(...rows: Array<Array<string>>): string {
	return JSON.stringify(
		rows.map((names, index) => ({
			number: index + 1,
			title: `issue ${String(index + 1)}`,
			labels: names.map((name) => ({ name })),
			createdAt: '2026-09-10T00:00:00Z',
		})),
	)
}

const issue_depth_fixture = {
	depth_listing,
	labelled,
}

export { issue_depth_fixture }
