# codimango/css-shape-editor

## Description

A greenfield frontend task: the agent builds a browser-based **CSS clip-path shape
editor** from scratch under `/app` (`index.html` + `style.css` + `script.js`, no
build step). The editor must let a user add shapes to a canvas (circle, ellipse,
rectangle/inset, and polygons: triangle/pentagon/hexagon/star/custom), then move
(via inputs *and* drag), resize, rotate, recolor, set opacity, toggle visibility,
restack (z-order), adjust corner radius, delete, and export live CSS with a
copy-to-clipboard button.

The task tests whether a model can implement a **precise, multi-part DOM contract**
end-to-end: named element IDs (`#stage`, `#layersList`, `#shapeSettings`,
`#cssOutput`, …), a `#shapePicker` with `data-type`/`data-kind` buttons, per-shape
`.shape[data-id]` nodes on the canvas, `#layersList` rows keyed by `data-id` with
`data-action` buttons, and geometry expressed through inline `clip-path` for
inset/polygon shapes — including the rectangle→`inset(... round X%)` corner-rounding
mapping. Grading is **functional**: a pinned headless Chromium (Playwright) drives
each of 23 features through its documented DOM handle and reads back the resulting
DOM / computed styles. There is no image comparison.

A naive approach fails because visual correctness is not enough — the app must
wire the exact interactive contract: correct picker/layer/shape element structure
and `data-*` hooks, event handling that reacts to programmatic `input`/`change`,
`clip-path` geometry for inset/polygon shapes, z-index math for four distinct
reorder operations, a real canvas drag handler, and a live `#cssOutput` panel.
Cosmetic shortcuts pass a human eyeball but fail the driver.

`reward_type = bounded_continuous`: the reward is the **fraction of 23 feature
checks that pass** (in `[0, 1]`), so partial implementations earn partial credit
and models are differentiated by a continuous score rather than all-or-nothing.

## Completion Rates

Empirical results, commit `9628826` (per-trial reward = fraction of 23 checks).
Grader asserts only what `instruction.md` specifies: circle/ellipse accept
`clip-path` *or* `border-radius`; reorder is checked by relative order (not exact
z-index); `#cssOutput` need only be non-empty and reflect the shape's clip-path.

| Model | Trials | Mean reward | Per-trial rewards |
|---|---|---|---|
| Oracle | 3 | **1.00** | 1.00, 1.00, 1.00 |
| Opus 4.6 (`claude-code`) | 5 | **0.78** | 0.00, 0.91, 1.00, 1.00, 1.00 |
| Avocado (`metacode`) | 5 | **0.58** | 0.00, 0.00, 0.91, 1.00, 1.00 |
| GPT-5.5 (`codex`) | 5 | **0.00** | 0.00, 0.00, 0.00, 0.00, 0.00 |
| Sonnet 4.6 | — | not run | informational only; not part of validation |

Cloud validation verdict: **PASSING**, AI assessment **Accept** (0
Critical/High/Medium/Low). Oracle 100%, and the pass/fail-balance check passes on
continuous scoring. Calibration is textbook: **Opus and Avocado each reach full
solves (1.00) in some trials AND total failures (0.00) in others** — the task is
clearly solvable yet not trivially so, and a weaker agent (codex) fails outright.
(Model scores are nondeterministic run-to-run; e.g. Avocado has averaged 0.58–0.83
across runs.)

## Model Analysis

### Oracle — 3/3, mean 1.00
The reference passes all 23 checks on every trial, confirming the task is solvable
and the grader is internally consistent.

### Opus 4.6 — mean 0.78, bimodal (3 full solves, 1 near-miss, 1 total failure)
- **3/5 → 1.00:** full, correct implementations of the entire contract.
- **1/5 → 0.91:** a single missed feature (e.g. the pointer `drag` gesture or one
  polygon kind) out of 23.
- **1/5 → 0.00:** the app loaded (`load_error: None`) but `#shapePicker` was built
  **without** `button[data-type="…"]` options, so no shape could be added and every
  check failed at the first interaction — one wrong contract choice cascades to zero.

### Avocado — mean 0.58, bimodal (2 full solves, 1 near-miss, 2 total failures)
- **2/5 → 1.00** and **1/5 → 0.91:** correct or near-correct full contract.
- **2/5 → 0.00:** same failure class as Opus's zero — a `#shapePicker`/shape-add
  contract deviation that blocks all downstream interactions.

### GPT-5.5 (codex) — mean 0.00, all 5 failed
Never produced a working DOM contract (no addable shape), so all checks failed.
Shows the task genuinely discriminates capability.

### Failure modes across all models (dominant → minor)
1. **Total-contract failures → 0.00** (dominant): a wrong `#shapePicker` / shape-add
   structure means no shape is ever added, so all 23 checks fail. Accounts for
   codex's 5/5, and one Opus + two Avocado trials. Wiring the precise multi-element
   DOM contract is the core difficulty.
2. **Single-feature misses → 0.91:** an otherwise-correct app misses one of the 23
   features — most often the real pointer-drag gesture or a specific polygon kind.

These are **reasoning gaps, not task-setup issues**: the oracle passes 23/23 and
stronger agents reach full solves, so the environment and grader work as intended.
Failures come from deviating from the specified contract or missing a feature, not
from the task being mis-built. (A short per-action timeout makes a broken contract
fail fast rather than exhausting the verifier budget.)

## Anti-Cheating Analysis

- **Hardcoded outputs:** Grading drives the live UI in headless Chromium and reads
  back computed styles after real interactions (add/move/drag/resize/reorder/…);
  a static or hardcoded page produces no reactive DOM changes and scores ~0.
- **Overfitting to visible tests:** Checks assert *behavior* (geometry within 2px,
  z-index ordering across four reorder ops, `clip-path` shape families, visibility
  as any of display/visibility/opacity, clipboard contents == `#cssOutput`) rather
  than fixed strings, and `css_output` normalizes whitespace/case — there is no
  literal output to memorize.
- **Modifying test files:** `tests/` (`driver_lib.py`, `test_outputs.py`,
  `write_reward.py`, `test.sh`) is never part of the agent's workspace and Harbor
  masks it during the trajectory; the agent only writes `/app`. `test.sh` writes a
  `0` reward before grading so any tamper or crash yields an honest failure.
- **Bypassing the intended solution path:** the reward is the fraction of 23
  independent behavioral checks spanning add / five shape kinds / three polygon
  varieties / move / drag / rotate / resize / recolor / opacity / visibility /
  four reorders / delete / corner-round / css-output / copy — there is no single
  shortcut; each feature must actually be implemented against its documented DOM
  handle to earn its share.
