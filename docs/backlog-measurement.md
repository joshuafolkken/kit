# Isolated measurement of backlog startup

In a kit checkout, run `pnpm exec tsx tools/backlog/backlog-measure.ts <input.json>`.
The entry calls the production candidate fetch, candidate cache and driver, and creates a measurement-only Git repository, state, cache and worker record destination for each trial. It does not stop or restart the current run.

## Fixed input

The following is a complete offline input with one candidate and five dependency waits. For the multiple-candidate condition, remove `blockedBy` from each row. Set the number of runs with `repetitions`; free slots, memory waits and usage waits with `free_lanes`, `memory_held` and `usage_limited`; and the already-launched Issues with `in_flight`.

```json
{
	"name": "one-and-five",
	"mode": "cold",
	"repetitions": 5,
	"free_lanes": 2,
	"reads": [
		{
			"method": "gh.issue_list_by_label_summary",
			"args": ["auto-ok", 200],
			"encoding": "listing",
			"value": [
				{
					"number": 901,
					"title": "Ready",
					"createdAt": "2026-09-01T00:00:00Z",
					"author_association": "OWNER",
					"body": "",
					"labels": [{ "name": "auto-ok" }, { "name": "run:lane" }]
				},
				{
					"number": 902,
					"title": "Wait 1",
					"createdAt": "2026-09-01T00:00:00Z",
					"author_association": "OWNER",
					"body": "",
					"labels": [{ "name": "auto-ok" }, { "name": "run:lane" }],
					"blockedBy": { "nodes": [{ "number": 901 }] }
				},
				{
					"number": 903,
					"title": "Wait 2",
					"createdAt": "2026-09-01T00:00:00Z",
					"author_association": "OWNER",
					"body": "",
					"labels": [{ "name": "auto-ok" }, { "name": "run:lane" }],
					"blockedBy": { "nodes": [{ "number": 901 }] }
				},
				{
					"number": 904,
					"title": "Wait 3",
					"createdAt": "2026-09-01T00:00:00Z",
					"author_association": "OWNER",
					"body": "",
					"labels": [{ "name": "auto-ok" }, { "name": "run:lane" }],
					"blockedBy": { "nodes": [{ "number": 901 }] }
				},
				{
					"number": 905,
					"title": "Wait 4",
					"createdAt": "2026-09-01T00:00:00Z",
					"author_association": "OWNER",
					"body": "",
					"labels": [{ "name": "auto-ok" }, { "name": "run:lane" }],
					"blockedBy": { "nodes": [{ "number": 901 }] }
				},
				{
					"number": 906,
					"title": "Wait 5",
					"createdAt": "2026-09-01T00:00:00Z",
					"author_association": "OWNER",
					"body": "",
					"labels": [{ "name": "auto-ok" }, { "name": "run:lane" }],
					"blockedBy": { "nodes": [{ "number": 901 }] }
				}
			]
		},
		{
			"method": "gh.issue_list_by_label",
			"args": ["not-before", 200],
			"encoding": "listing",
			"value": []
		},
		{
			"method": "gh.issue_list_by_label",
			"args": ["epic", 200],
			"encoding": "listing",
			"value": []
		},
		{ "method": "gh.repo_get_name_with_owner", "args": [], "value": "measurement/isolated" },
		{ "method": "gh.issue_list_by_label_in_repo", "encoding": "listing", "value": [] },
		{
			"method": "defect.measure_window",
			"value": {
				"days": 14,
				"since": "2026-09-01",
				"defects": 73,
				"enhancements": 100,
				"is_capped": false
			}
		},
		{ "method": "net.measurements", "value": { "growth": {} } },
		{ "method": "resume.paused_issues", "encoding": "set", "value": [] },
		{ "method": "resume.open_pr_issues", "encoding": "set", "value": [] }
	]
}
```

`reads` replaces only the listed reads with fixed responses. A row with `args` matches only on exactly those arguments; a row without them covers every call of that read. `json` restores a plain JSON value, `listing` an Issue-list JSON response, and `set` a set of Issue-number strings. A read that is not listed goes through the production read implementation.

For a future start condition, write `- 実施可能日: 2999-01-01T00:00Z` inside `## 背景` of the Issue body and include `not-before` in the existing labels. An input that needs a label sync fails as a refused tracker change. Passing `outcomes` such as `{"901":"failed"}` also checks a failed or waiting replacement launch.

## warm / cold and live requests

- `cold`: each repetition creates a new process, Git work area, state and cache.
- `warm`: runs once beforehand in one isolated process, then repeats the given number of times keeping the same input, state and cache. The pre-run is excluded from aggregation as `warmup: true`. Each repetition gets its own worker record destination. When the cache expiry or the input key changes, the read misses as in the existing implementation, so read the hit/miss in the raw records alongside.

For a REST read that has to be live, list the full relative GitHub API endpoint (query string included) in `live_get` and remove the matching fixed response. Only `gh api` GETs to an allowed endpoint pass, with read flags such as pagination, include and jq allowed. GraphQL, tracker writes, arbitrary commands and real worker launches are refused. When a read from GraphQL is replaced with a fixed response such as a set, that boundary is not part of the live-request measurement.

## Raw records and comparison

The `root` on standard output is where the artifacts are. Each trial saves `input.json`, `status.json`, `startup.jsonl`, `boundaries.json` and `result-N.json`. A child process that exceeds `timeout_ms` (60 seconds by default) fails; when the parent process itself is interrupted, the `incomplete` written at the start remains.

`startup.jsonl` is the raw record of the existing startup scope and storage API, tied to the run, attempt and Issue. `result-N.json` holds the result of the existing aggregation API, the candidate order, the wait reasons, the driver's state and refusal results, and the source of each boundary. `live` is a real process read, `replay` a fixed response, `replacement` the replacement worker's behaviour, and `denied` a refusal. The API count counts the actual request path; calls to fixed responses are counted separately in the boundary record. Git reads are also counted as `live`, so do not use the number of boundary rows in place of the API count.

The measured range is the candidate fetch, the cache and the driver's start decision. Budget answers and resource conditions are fixed by the input, and lane preparation and the real worker are replaced. The replacement worker's phase is recorded explicitly. **Do not treat the time of this range as the startup time of the whole production run.** Node file writes are allowed only under root, and reads by external processes are limited to the isolated cwd and the allowed commands. A trial that failed, was refused, was interrupted or lacks measurement records is not mixed into the successful samples.

## Completeness and warm origin

`completed` in `status.json.status` reflects only the exit state of the child process. Read `measurement_complete` and each `result-N.json.completeness` alongside it. The entry's `succeeded` is true only when every planned result exists and every trial is `normal` or an intended `waiting`.

- `normal`: the required steps finished, with no missing read, no search cap and no inherited incomplete warmup. `normal_sample: true`.
- `degraded`: the outer selection continued, but a child step failed, a required defect rate is missing, or a read result has `is_capped: true`.
- `failed`: the outer selection or the replacement launch failed.
- `waiting`: after a normal selection, the launch waits on the resource or start condition given in the input. Not counted as a normal startup-time sample.
- `incomplete`: a step has no end record, or there is no startup record at all. When the parent is interrupted, the status written at the start remains, as before.

`reasons` shows the incompleteness of child steps and reads. An `observation` boundary is a check of a read result — neither a request count nor an extra call to a fixed response. Later warm results save the pre-run's attempt in `warmup_origin`. The reason for an incomplete warmup is inherited even when the later results are a cache hit with zero API calls. The whole group is excluded conservatively; a cache expiry and refetch partway through does not on its own promote it to an independent normal group. The production cache's storage conditions and fallbacks stay as in the existing implementation.

A failure of an allowed live GET is saved in the boundary's `failure`, `http_status` and `response_reason`. `endpoint_index` is the zero-based position in the input's `live_get` (-1 when not listed). Response bodies, error text and account information are not saved; only known response reasons are classified into fixed wording. `unreported` means the reason or status could not be obtained; a 403 alone is not presumed to be a rate limit. The startup API count is the number of actual call attempts, retries included, and is separate from the number of HTTP failure boundaries, missing searches and successful fetches.

## Live-request samples under the same conditions

The defect-rate search splits the original `created:>=` / `closed:>=` period into non-overlapping intervals at one-second granularity only when it exceeds 1000 results. The last interval has no upper bound, keeping the original population. Each interval is fetched at 100 per page, up to 1000 results, and up to 15 intervals (the pre-split search included) are read per original search. For an interval over 1000 results only the first page is read, with no retry. An HTTP failure is a missing value; an incomplete response, a count mismatch, a duplicate, an exhausted split budget, or exceeding the cap even at one-second granularity stays `is_capped: true` and is excluded from the normal group.

A re-measurement runs a copy of the saved input through a new isolated entry, keeping the candidates, dependencies, resource conditions, original query and start date. The split's reference date is the UTC date at aggregation time and stays fixed within the same UTC day. Align the reference date between cold and warm, and add each interval's exact-match endpoint and page to `live_get`. An interval missing from the allowlist is refused as before, so such a trial is not adopted as a normal sample. Only when the required search API budget has recovered, every interval and every page succeeded, and the original search's count matches the duplicate-free union can the run return to normal live-request repetitions. The current live run's input, state and launches are not touched, and the normal-sample judgement and the external-write refusal are kept. The performance comparison and the certification of seconds saved happen in #7423. The second-granularity period follows [GitHub's search syntax](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests#search-by-when-an-issue-or-pull-request-was-created-or-last-updated).

Keep the original input that fixes candidates 901–906 and their dependencies, the start condition, the free slots, and the search query, date and page. Replaying the candidate list, the dependencies and the like, and making only the measured defect-rate GETs live, measures the target reads without changing the candidate set. The search population on GitHub cannot be fixed, though, and even the same query can come back incomplete through later updates or the fetch cap. To adopt a normal sample, confirm each time that every target search succeeded, that `is_capped: false`, and that the independent cold trials and the warm pre-run and all its repetitions are complete. All-replay groups are not mixed into the live-request baseline.

On 2026-11-13, the saved `live-one-cold` / `live-one-warm` / `live-multiple-cold` / `live-multiple-warm` inputs of #7423 were re-run unchanged through the isolated entry. Cold ran 3 times each; warm ran a pre-run and 5 times each. Missing values from the search cap or HTTP 403, and their inheritance from the warm origin, left all four groups with **n=0** normal samples. Trials whose live GETs succeeded were also excluded for the search cap. No evidence was obtained that the fetch conditions of the allowed GETs can be met, and the performance comparison is not established. The original inputs and artifacts are kept locally under `josh/measurements/7460-completeness/` in the git common directory. Production run operations or a change of search range are not a substitute.

## Re-measurement procedure after split fetching (#7423)

The target is commit `928d1f7813d774b141cf56e30229beaa63bf5d57`. Keep the inputs of the existing four groups and add only exact-match GET permissions for the split intervals. Do not change the candidates, dependencies, start condition, resource conditions, original query or since. The first split on 2026-11-13 UTC was at 2026-11-06T12:00:00Z; the left interval ends one second before it, and the right stays open. Permissions down to depth 3 (15 intervals) of each original query are generated in advance. A trial that needs a deeper split is excluded as outside the permissions.

Cold runs 3 independent trials per group; warm runs one normal pre-run and 5 repetitions in the same process. Each cold call uses a repetition count of 1, and the groups run alternately. Waiting for the search quota to recover happens outside the trial and is not added to the step time. Each trial is adopted into the normal group only after its completeness and warm origin are confirmed. Because the trials are sequential, the shared effect of concurrent misses cannot be measured.

The mapping between the raw records and their original temporary roots is saved under `josh/measurements/7423-baseline-928d1f7/` in the git common directory. For each group and trial, `scenario.json`, `run.json` and the input/status/startup/boundaries/result under `raw/0/` are kept. These are local artifacts, not public attachments. The API is counted per gh spawn; step times are not summed, because the parent includes its children. The fixed-response candidate list and dependency lookups, and the replacement worker, are not part of the performance samples of live requests and real launches.

### Normal cold samples

The figures are median / maximum (ms). n=3 per group, every trial normal. The candidate cache and the defect-rate cache were hit0/miss3/fill3 per group, with 60 REST calls per group (filed13 / completed7 per trial). Concurrent misses were 0 per group, but only under the sequential condition.

- Single candidate: parent 11500.791 / 11722.064, candidate cache fill 10906.588 / 11214.388, candidate list 1.314 / 1.357, candidate eligibility 10863.676 / 11178.841, defect rate 10846.395 / 11165.119, defect-rate cache fill 10844.781 / 11164.041, eligibility 23.695 / 26.633, replacement worker (n=3) 0.408 / 0.429.
- Multiple candidates: parent 11082.591 / 13858.114, candidate cache fill 10319.084 / 13276.682, candidate list 1.097 / 1.115, candidate eligibility 10275.970 / 13243.541, defect rate 10261.921 / 13230.863, defect-rate cache fill 10260.335 / 13229.687, eligibility 25.698 / 34.130, replacement worker (n=6) 0.550 / 1.074.

The cold defect-rate read dominates this range. Fetching completed as a count is a follow-up candidate whose equivalence is to be verified. A cache overlapping the existing shared candidate cache is not adopted. Sharing concurrent lookups, narrowing the waiting-Issue lookup, sharing Issue information before launch, and real lane preparation are held back, because this sequential, fixed-response, replacement-launch measurement cannot judge their effect. The difference in medians by candidate count is not treated as a causal effect, and no seconds saved are promised.

### Checking warm, selection and controls

Warm had n=5 per group, excluding one normal pre-run each. The single-candidate parent had a median of 12.516 / maximum of 14.108 ms, and the replacement worker (n=5) 0.352 / 0.514 ms. The multiple-candidate parent had 12.009 / 14.132 ms, and the replacement worker (n=10) 0.471 / 0.563 ms. Every group had candidate cache hit5/miss0/fill0, REST0 and 0 concurrent misses. On a candidate cache hit, child steps such as the defect rate do not run, and their time is not treated as 0 ms. Each pre-run made 20 REST calls, filed13 / completed7 as in cold. The 16 normal samples made 120 REST calls in total, and the whole collection, pre-runs included, 160.

Single candidate: 901 is selected and launched by the replacement, and 902–906 wait on their dependency on 901. Multiple candidates: 901–905 are selected, and with 2 free slots 901 and 902 are launched by the replacement. The input of 6 is told apart from the output cap of 5. Every normal sample had no duplicate in in_flight and no refusal boundary. There were 0 samples of real resource waits, real lane preparation and real worker launches.

The saved control inputs were also re-run once each. failed-worker was failed, with one launch call and one stall record; waiting-worker was waiting, with one launch call; in_flight was empty for both. The memory/capacity/usage waits and the future start condition were waiting, with no launch. already-running kept only 901, with no additional launch. A 1 ms timeout gave no result and timed_out. These 8 and the earlier incomplete trials are not part of the denominator of normal times.

The original run `f660a273f2e9309a` took 18.446 seconds from start 03:05:33.536Z to offer 03:05:51.982Z, and 39.240 seconds to child-launch 03:06:12.776Z. seen was 7419/7400/7384/7228/5510/5272/5085 and started was 7419, which differ from this fixed input. The time after launch start 03:05:54.015Z is not treated as install time, and ledger dispatch 03:06:12.826Z is a separate observation point. Its start and end points and its denominator differ from this parent interval, so the difference is not counted as seconds improved. The original API/cache/install breakdown cannot be recovered.

`summary.json` saves the median and maximum of every step, the API count per sample and the selection results. The median of an even count is the mean of the middle two values. The verification script checks equivalence with the fixed input, completeness, warm origin, agreement of the API counts with the request boundaries, order and uniqueness, and the states of the 8 controls. `manifest.json` keeps the SHA-256 of the re-run and aggregation scripts and of the raw records. Even with the same query the GitHub population and the host load vary, so the cold n=3 results are not used as a guarantee for the whole production run.

## Fetching the denominator as a count (#7424)

The denominator reads the `total_count` of the same `is:issue is:closed reason:completed label:enhancement closed:>=<since>` query with `per_page=1`. The lower-bound date and the open upper bound are kept, and the denominator needs no period split for the 1000-result list cap. A count is adopted only from a response with a non-negative integer and `incomplete_results: false`. An incomplete response or an invalid count is not searched again; it is a missing value and is not kept in the cache. A transient HTTP failure is retried by the existing transport layer; if it still fails, it is a missing value and is not kept in the cache. This follows [the search API's specification for incomplete results](https://docs.github.com/en/rest/search/search#timeouts-and-incomplete-results).

The numerator keeps the full fetch of bodies and labels and the period split, as before. A strict defect declaration in the body alone and any of `bug` / `bugfix` / `route:interrupt` are counted, and the defect rate is computed even with one candidate. The existing cache key and its 15-minute freshness, and the 60-second candidate cache, are kept. Sharing concurrent misses and narrowing the waiting-Issue and plan-comment lookups are not adopted, because the sequential measurement of #7423 cannot judge their effect.

### Comparison after switching to the count fetch

On 2026-11-13, the four saved groups were re-run keeping their candidates, dependencies, start conditions, resource conditions, query and since, adding only the exact-match GET permission for the new `per_page=1`. Cold ran 3 independent processes each and warm 1 pre-run + 5 repetitions each, for 16 normal samples. The selection, replacement launch, uniqueness and the absence of refusal boundaries were checked for every sample. In a separate live-request check, a full fetch of the same denominator query (632) matched the `total_count` (632).

- Cold made 14 REST calls in all 6 trials (filed13 / completed1), 6 fewer than the baseline's 20, a 30% reduction. Warm hit the existing candidate cache with REST0 in all 10 repetitions, and each pre-run made 14. The requests of the numerator, which reads bodies, were not reduced.
- The parent interval's median / maximum (ms) was single cold 11124.008 / 11576.022, multiple cold 11202.478 / 11867.702, single warm 18.100 / 21.508, multiple warm 49.808 / 64.403. The cold medians did not improve in one direction, and warm is slower than the baseline too. This is not a controlled comparison with fixed host load, and warm does not run the changed defect-rate processing at all, so the difference is not certified as a causal effect of the switch. The basis for adoption is the reduced API count with the same selection results; no seconds of startup improvement are promised.
- The 8 saved controls were also re-run, and the states and launch numbers for failure, waiting, already running, start date and timeout matched. A separate isolated-process test confirmed reuse of a completed cache by another process, TTL expiry, retry after a failure, and recalculation after a process ended mid-calculation. Concurrent misses still had two processes each run two searches, without merging the calculation. Artificial concurrent misses are kept apart from a measurement of how often duplicates occur in real operation.

The raw records, the aggregation and re-run scripts, the exact-match GET permissions and the SHA-256 manifest are saved under `josh/measurements/7424-count-1794567921838/` in the git common directory, and the 8 controls under `josh/measurements/7424-controls-1794568032073/`. Performance samples of real lane preparation and real worker launches are not included.

## Pre-launch reads without a declaration (#7425)

The normal samples of #7423 and #7424 did not measure the provenance check before a real launch, so only the reads after selection were measured in addition. Real lane preparation, install and setup are unchanged. Independent launches keep the existing parallel processing, and a parallelization that runs a split or a launch ahead of close or a sample wait is not adopted.

On 2026-11-13, the real Issue #7425 with no declaration (single) and #7425/#7424 (multiple) were used. The current provenance read → labels/body was compared with the REST body's declaration check → labels/body. For each condition, cold ran 3 independent processes and warm 5 repetitions within each process (15 in total). Cold was process/memo cold, with the disk ETag kept. Every cold REST call returned 304.

The figures are median / maximum (ms); API counts are gh spawn counts within the group (not HTTP billing counts).

- Single cold: current 1326.024 / 1736.971, REST3 + GraphQL3. Early check 657.012 / 709.033, REST3.
- Single warm: current 621.943 / 1086.528, GraphQL15. Early check 0.134 / 0.153, API0.
- Multiple cold: current 2730.527 / 3060.829, REST6 + GraphQL6. Early check 1313.060 / 1457.185, REST6.
- Multiple warm: current 1285.576 / 2207.028, GraphQL30. Early check 0.194 / 0.274, API0.

After the current provenance read, labels/body took 0 extra REST calls, shared through the existing memo. What the change removes is the GraphQL call made every time even with no declaration, not a duplicate REST call. The change only skips the provenance lookup when there is no declaration. With a declaration, or an insufficient body, it goes on to the original provenance read, and re-parses and runs the declaration from the snapshot whose author/editor were verified. A command from an unverified body is not run.

Only the body in the existing REST memo is shared, and it is never used as execution permission. The memo holds the fetch start time and keeps the 10-second TTL, the full invalidation on an Issue write and the deletion on failure. An expired entry is fetched again. A stale no-declaration hint may skip the measurement, but never permits a command. Running from a stale declaration, an insufficient body or an untrusted snapshot follows the existing verification. No new cache and no sharing of execution permission across launch processes is added.

The 5 waits of the single condition come after selection, so they are outside the reads and launches, and the local probe of the 2 multiple Issues ran sequentially. Candidate selection, resource waits, real lane preparation and real workers were not measured. The records of the previous sections — the selection equivalence for 1 candidate + 5 dependency waits and for multiple candidates, and the controls — stand. Because of the fixed order, the small samples and the host load, the differences above are not certified as seconds saved in the whole production startup.

The 6 raw records, the probe, aggregation and no-side-effect smoke scripts, the summary and the SHA-256 manifest are saved under `josh/measurements/7425-prelaunch-1794570480/` in the git common directory. The probe uses only the production provenance read, REST read and declaration parser, and calls no measurement command, close/comment, split unit or lane/worker. The smoke called the changed production decision with command execution and tracker writes refused, and confirmed `launch`, REST1 and GraphQL0.
