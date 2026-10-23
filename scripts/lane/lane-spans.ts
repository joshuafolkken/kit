// The spans an issue's starts open and its ends close, shared by `josh lane:stats`' gaps
// (`lane-gap-stats.ts`) and `run:board`'s in-lane time (`run-board-lane-time.ts`)
// (joshuafolkken/kit#4463).

// One instant an issue's wait can end at. `issue` is absent on a stage whose writer held none.
interface IssueAt {
	issue: number | undefined
	at_ms: number
}

interface IssuePair {
	starts: ReadonlyArray<IssueAt>
	bounds: ReadonlyArray<IssueAt>
	ends: ReadonlyArray<IssueAt>
}

interface Span {
	from_ms: number
	end_ms: number | undefined
}

// The issue's next start of any kind closes the window: an end after it belongs to that later start,
// so a start never ended stays not ended rather than borrowing a later run's end.
function next_start_ms(
	starts: ReadonlyArray<IssueAt>,
	issue: number | undefined,
	from_ms: number,
): number {
	const later = starts.filter((other) => other.issue === issue && other.at_ms > from_ms)

	return Math.min(...later.map((other) => other.at_ms))
}

// Each start until the first end of its own issue, before that issue's next start in `bounds`.
function issue_spans(pair: IssuePair): Array<Span> {
	return pair.starts.map((start) => {
		const until_ms = next_start_ms(pair.bounds, start.issue, start.at_ms)

		return {
			from_ms: start.at_ms,
			end_ms: pair.ends.find(
				(end) => end.issue === start.issue && end.at_ms >= start.at_ms && end.at_ms < until_ms,
			)?.at_ms,
		}
	})
}

const lane_spans = { issue_spans }

export { lane_spans }
export type { IssueAt, IssuePair, Span }
