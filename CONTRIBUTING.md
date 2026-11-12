# Contributing to kit

Thank you for your interest in kit. Contributions start with a GitHub Issue: agree on the change
there first, then open a pull request.

## Reporting a bug or requesting a feature

Open an [Issue](https://github.com/joshuafolkken/kit/issues/new).

- **A bug** — the steps to reproduce it, what you expected and what happened, the kit version
  (`package.json` → `@joshuafolkken/kit`), and the stack of the project using kit.
- **A feature request** — the problem you want to solve, not only the solution you have in mind.

Report a vulnerability through [the security policy](./SECURITY.md), not in a public Issue.

## Agree on an Issue before opening a pull request

Settle the approach on the Issue before you write code. A pull request without an agreed Issue may
be closed. Why the Issue comes first:

- An Issue filed by an author without write access is not picked up by kit's unattended runs, even
  with the `auto-ok` label. It moves once a maintainer records a plan for it.
- CI on a first-time contributor's pull request waits for a maintainer's approval.
- The release classification label, which the required `Release classification` check reads, can
  only be applied by someone with write access, so a maintainer applies it.
- Only Dependabot pull requests are merged automatically; every other pull request is merged by a
  maintainer.

How a pull request from a fork moves through kit's own review and merge tooling, and whether its CI
passes as it does for a branch in this repository, has not been verified yet. Expect a maintainer to
take it over where it does not.

## Decisions not to act, and when they are revisited

When a report is declined or kept under consideration, the reason is written on the Issue or epic
that handles it, together with what you can do in your own project meanwhile and what would move it
forward — the condition under which it would be revisited, or a question back to you. For an example,
see the items under consideration listed on
[#7212](https://github.com/joshuafolkken/kit/issues/7212). If that condition is met later, or you can
answer the question, comment on the same Issue rather than opening a new one.

## Language

Write Issue and pull request titles in English. The body may be in English or Japanese.

## Code of conduct

Everyone taking part is expected to follow the [code of conduct](./CODE_OF_CONDUCT.md).

## Maintainer documentation

How kit itself is developed and released is in
[the maintainer documentation](./docs/maintainers/README.md).
