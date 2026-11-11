## Step 1: Issue template (en)

The `en` column of `issue-template.md`'s template; its rules and label table → `issue-template.md`. Keys, fixed values and headings → `scripts/issue/issue-body-keys.ts`, mirrored in the table below.

````md
## Background

<`- Type: defect` for a defect, else `- Type: non-defect`>
<for a defect `- Cause: #<PR>`, or `- Cause: unknown (<reason>)` when it cannot be traced>
<`- Human judgement: not needed` or `- Human judgement: needed (<policy decision / external account / visual check>)`>
<when a measurement picks: `- Decision rule: <condition> then <A>, else <B> (#<measurement Issue>)`, with `Human judgement: not needed`>
<for a cause that lengthened a lane: `- Cause lane: <minutes> minutes (#<N>)`; the minutes from `pnpm josh lane:net <N>`>
<the minutes this Issue's cause could save: `- Cause loss: <minutes> minutes`, one line per recurrence>
<for a security finding: `- Security: <the bypassed gate, guard or permission>`>
<for a run-machinery defect that parked an Issue or stopped a run: `- Cause park: #<N>`, one line per number, same repository only>
<for a behavior change: `- Enforcement: <the hook, lint or gate that stops it>` (none: `- Enforcement: measurement only`)>
<for a behavior change: `- Measurement: <the number that shows a violation (command name)>`>
<optional: `- Priority: critical (condition <1-3>)`, `- Priority: high (<basis>)` or `- Priority: normal`>
<the diff estimate: `- Size estimate: about <N> files / <M> lines (excluding tests)`, counting docs, snapshots and command listings>
<past the guide, cap or bar (`split-assessment.md` → "The question") as one Issue: `- No-split reason: <reason>`>
<each figure a decision used: ``- Premise: `<command>` <comparison> <figure>`` (one figure per line)>

<why it is needed>

## Symptom

<the current problem>

## Expected result

<what done looks like>

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Trigger

<only for an Issue that changes AI behavior: the one tool call first made when the rule breaks (`Bash` / `Edit` / `Read` / `Write` / `AskUserQuestion`; `Stop` for a rule judging the reply)>

## Baseline

<only for an Issue that changes AI behavior: a command and its value>

- `<measurement command>` → <current value>

## Reproduction

<only for an Issue that changes AI behavior, or a defect with `- Cause: unknown (<reason>)`: a command and its actual output, fenced (``` or ~~~)>

- `<reproduction command>`

```
<actual output>
```

## Expected effect

<only for `- Purpose: time saving`; the source is a command and its value>

- Hit rate: <value>
- Gain per hit: <value>
- Loss per miss: <value>
- Source: <`pnpm josh lane:stats` → value>

## Origin

<only when filed from another repository's session: the originating Issue as `owner/repo#N`; omit the section otherwise>
````

### Correspondence table

| Kind    | ja             | en                     |
| ------- | -------------- | ---------------------- |
| key     | 種別           | Type                   |
| key     | 目的           | Purpose                |
| key     | 互換性         | Compatibility          |
| key     | リリース分類   | Release classification |
| key     | 人の判断       | Human judgement        |
| key     | 判定規則       | Decision rule          |
| key     | 優先度         | Priority               |
| key     | セキュリティ   | Security               |
| key     | 原因の park    | Cause park             |
| key     | 原因のレーン   | Cause lane             |
| key     | 原因の損失     | Cause loss             |
| key     | 実施順         | Order                  |
| key     | 原因           | Cause                  |
| key     | 規模見積もり   | Size estimate          |
| key     | 分割しない理由 | No-split reason        |
| key     | 行を増やさない | No added lines         |
| key     | 先行リファクタ | Refactor first         |
| key     | 強制           | Enforcement            |
| key     | 計測           | Measurement            |
| key     | 計測宣言       | Measure declaration    |
| key     | 前提           | Premise                |
| key     | 計測宣言なし   | No measure declaration |
| key     | 実施可能条件   | Sample gate            |
| key     | 実施可能日     | Not before             |
| key     | 出どころ       | Source                 |
| value   | 不具合         | defect                 |
| value   | 非不具合       | non-defect             |
| value   | 振る舞い変更   | behavior change        |
| value   | 機能追加       | feature                |
| value   | 機能改善       | improvement            |
| value   | 時間短縮       | time saving            |
| value   | 不具合修正     | bug fix                |
| value   | 破壊的変更     | breaking change        |
| value   | 不要           | not needed             |
| value   | 要             | needed                 |
| value   | 通常           | normal                 |
| value   | 高             | high                   |
| value   | 緊急           | critical               |
| value   | 最後           | last                   |
| value   | 不明           | unknown                |
| value   | なし           | none                   |
| heading | 背景           | Background             |
| heading | 現象           | Symptom                |
| heading | 期待結果       | Expected result        |
| heading | 受け入れ条件   | Acceptance criteria    |
| heading | 発火点         | Trigger                |
| heading | ベースライン   | Baseline               |
| heading | 再現           | Reproduction           |
| heading | 期待効果       | Expected effect        |
