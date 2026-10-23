# Machine learning and data — case tables for pipelines, models and LLM features

**Currency stamp: 2026-10-06.** Parent §20–§21 own the principles. This file is the case checklist for data pipelines, trained models and features built on a large language model, plus the tools that check each case. Tool facts were checked against each project's docs; verify against the installed versions before relying on them.

## Contents

1. Data cases
2. Validate data at the boundary
3. Model behavior tests
4. Slices, not just the overall score
5. Determinism and tolerances
6. Drift and shift
7. Features built on a large language model
8. Traps

---

## 1. Data cases

Run every input column or field through `edge-cases.md`, plus these:

- Missing values in each form the data uses: null, `NaN`, empty string, sentinel values (`-1`, `9999`, `"N/A"`)
- Values out of the training range; categories never seen in training; a column with one value only
- An empty batch, a one-row batch, a batch with duplicated rows, a batch far larger than usual
- Schema drift: a renamed, reordered, retyped or new column; units changed upstream (cents versus currency units)
- Time: late-arriving rows, out-of-order events, time zones in timestamps, data from the future
- Leakage: a feature that encodes the label, or a split that lets future rows into training — split by time or by entity when the real use does

## 2. Validate data at the boundary

Check data where it enters the pipeline and before it reaches the model, and fail loudly:

- **Dataframes:** pandera schemas (`pa.Column(int, pa.Check.ge(0))`) — they live in the code next to the pipeline. If the team already runs Great Expectations suites, add the expectations there instead ("values not null", "values between").
- **Records** (an API request feeding a model): Pydantic models.
- **Integrity and train–test checks:** Deepchecks' `data_integrity()` and `train_test_validation()` suites.

A validation failure is a case-table row too: the expected behavior (drop, quarantine, alert, stop) is decided on purpose and tested.

## 3. Model behavior tests

Aggregate accuracy hides specific failures. Write behavior tests in three kinds (CheckList, Ribeiro et al., ACL 2020):

| Kind | What it asserts | Example |
|---|---|---|
| Minimum functionality | Simple cases the model must get right | "The food was great" → positive |
| Invariance | A change that must **not** change the output | Swap the person's name or city; add a typo; reorder irrelevant fields |
| Directional expectation | A change that must move the output one way | Adding "but the service was terrible" must not raise the positive score |

Generate the variants from templates and sample catalogues, run them as normal tests with a pass-rate threshold per test, and keep each failure as a fixed example. For a custom scikit-learn estimator, `sklearn.utils.estimator_checks.check_estimator` checks the library conventions.

## 4. Slices, not just the overall score

Evaluate per segment — language, region, device, new versus returning users, rare classes, the longest and shortest inputs — and set a floor per slice. A model can improve overall while getting worse for one group; only a sliced report shows it. Deepchecks' `model_evaluation()` suite and a plain grouped metric both work.

## 5. Determinism and tolerances

- Fix every seed (Python, NumPy, the framework). In PyTorch: `torch.manual_seed(0)` and `torch.use_deterministic_algorithms(True)`.
- Even then, PyTorch documents that results are not guaranteed to match across releases, commits, platforms, or CPU versus GPU. So assert with tolerances (`abs(a - b) < 1e-4`, a metric within a band), never exact float equality across machines.
- Pin small fixture datasets in the repository so a test's input never changes under it.

## 6. Drift and shift

Simulate the shift before production does: build a batch with a shifted distribution (prices up 30%, a new category dominating, a missing feature) and assert that the drift check fires and the pipeline does what the case table says (alert, fall back, stop). Deepchecks' train–test drift checks cover the common cases.

## 7. Features built on a large language model

Outputs vary from run to run, so assert **properties**, not exact text, and run each case several times.

| Case | Expected property |
|---|---|
| Empty input, one word, the longest input the product allows (near the context limit) | A defined response or a clear refusal; no truncated JSON |
| Another language, mixed scripts, emoji | Answers in the expected language |
| Prompt injection inside user content or a retrieved document ("ignore previous instructions…") | Instructions in data are not followed |
| Personal data in the input | Not echoed where it must not be |
| Off-topic or harmful requests | The product's chosen refusal |
| Structured output | Parses and matches the schema every time |

promptfoo runs such case sets from a config file — each test case with an `assert:` list (exact match, contains, JSON schema, model-graded checks) — via `promptfoo eval`. Keep the case set in the repository and run it when the prompt, model or retrieval changes.

## 8. Traps

- **One overall metric as the only test.** Pair it with behavior tests and per-slice floors.
- **Random splits for time-ordered data.** They leak the future into training and overstate quality.
- **Exact-text assertions on generated output.** They flake; assert properties.
- **Evaluation sets that silently change.** Version them; a moving test set makes every comparison meaningless.
