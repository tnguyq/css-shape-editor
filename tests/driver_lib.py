"""Drive + grade the interactive CSS shape editor in headless Chromium.

The task is graded FUNCTIONALLY: we load the agent's app (/app/index.html) in a
pinned headless Chromium, drive each editor feature through its documented DOM
contract, and read the resulting DOM / computed styles back. There is no image
comparison -- correctness is measured by whether each interaction produces the
expected geometry / style.

reward_type = "bounded_continuous": the reward is the FRACTION of the feature
checks that pass (passed / total, in [0, 1]). The checks cover:

  add_shape                -- pick a circle + Add -> a real clip-path shape appears
  shape_ellipse            -- ellipse picker -> clip-path: ellipse(...)
  shape_inset              -- rectangle (inset) picker -> clip-path: inset(...)
  shape_polygon_triangle   -- polygon/triangle -> clip-path: polygon(...)
  shape_polygon_star       -- polygon/star -> clip-path: polygon(...)
  shape_polygon_pentagon   -- polygon/pentagon -> clip-path: polygon(...)
  shape_polygon_hexagon    -- polygon/hexagon -> clip-path: polygon(...)
  shape_polygon_custom     -- polygon/custom -> clip-path: polygon(...)
  move                     -- X/Y inputs reposition the selected shape
  drag                     -- pointer drag on #stage repositions the shape
  rotate                   -- rotation input rotates the selected shape
  resize                   -- W/H inputs resize the selected shape
  recolor                  -- layer colour input recolours the selected shape
  opacity                  -- layer opacity range changes the shape's opacity
  visibility               -- layer checkbox hides the shape (display/vis/opacity)
  reorder_front            -- data-action="front" brings a shape to the top
  reorder_back             -- data-action="back" sends a shape to the bottom
  reorder_forward          -- data-action="forward" moves a shape up one step
  reorder_backward         -- data-action="backward" moves a shape down one step
  delete                   -- data-action="delete" removes the shape + its layer
  corner_round             -- #borderRadiusSlider rounds an INSET via clip-path
                              inset(... round X%) (NOT the CSS border-radius prop)
  css_output               -- #cssOutput reflects the selected shape's live CSS
  copy_css                 -- #copyCssBtn writes the CSS to the clipboard

This module is imported by both write_reward.py (reward) and test_outputs.py
(per-feature ctrf report). It is NEVER visible to the evaluated agent.

The DOM contract this grader depends on (specified in instruction.md and
implemented by the agent):
  * #shapePicker button[data-type="circle|ellipse|inset|polygon"] (polygons also
    carry data-kind); clicking selects the active shape type.
  * #addShapeBtn adds the currently-picked shape to the canvas.
  * #stage contains one .shape[data-id] element per shape; the just-added shape
    also carries the .selected class. Each .shape uses an inline CSS clip-path
    for its geometry, style.zIndex for stacking, and absolute left/top/width/
    height in px.
  * #layersList contains one row element carrying [data-id] per shape (any tag --
    <li>, <div>, ...), each with an input[type="color"] (fill),
    input[type="range"] (opacity), input[type="checkbox"] (visibility), and
    button[data-action="front|back|forward|backward|delete"] controls.
  * Shape Settings inputs: #xInput #yInput #wInput #hInput #rotationInput
    (number) and #borderRadiusSlider (range) act on the selected shape;
    #borderRadiusSlider rounds an inset's corners via clip-path round.
  * #cssOutput shows the selected shape's live CSS; #copyCssBtn copies it.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

APP_HTML = "/app/index.html"
RESULT_CACHE = "/tmp/editor_result.json"

VIEWPORT_W = 1280
VIEWPORT_H = 800

# Numeric tolerance (px / deg) for reading geometry back out of computed styles.
TOL = 2.0

# Per-action Playwright timeout (ms). Short so a missing DOM handle fails fast
# instead of burning the 30s default -- bounds total verify time across 23 checks.
ACTION_TIMEOUT_MS = 5000

LAUNCH_ARGS = [
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    "--force-color-profile=srgb",
]

# JS helper injected into every page: set an <input> value and fire the events an
# app listens for (input + change) so number/range/color controls react exactly
# as they would to a real user edit.
_SET_VALUE = """
([sel, val]) => {
  const el = document.querySelector(sel);
  if (!el) throw new Error('missing element: ' + sel);
  el.value = val;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}
"""

# Stub the async Clipboard API before any page script runs, so the
# copy-to-clipboard feature can be tested deterministically in headless Chromium
# (real clipboard access on file:// origins is unreliable). Any
# navigator.clipboard.writeText(text) the app calls is recorded into
# window.__copied, which the copy check reads back.
_CLIPBOARD_STUB = (
    "window.__copied=null;"
    "(function(){var rec=function(t){window.__copied=t;return Promise.resolve();};"
    "try{if(!navigator.clipboard){Object.defineProperty(navigator,'clipboard',"
    "{value:{},configurable:true});}navigator.clipboard.writeText=rec;}"
    "catch(e){try{Object.defineProperty(navigator,'clipboard',"
    "{value:{writeText:rec},configurable:true});}catch(_e){}}})();"
)


def _new_page(browser):
    page = browser.new_page(
        viewport={"width": VIEWPORT_W, "height": VIEWPORT_H},
        device_scale_factor=1,
    )
    # Fail fast: when an app is missing a required handle, a click/wait should
    # error in a few seconds, not the Playwright default 30s. With 23 checks this
    # keeps a broken app's grade well under the verifier timeout (a 30s-per-miss
    # default previously pushed one verify past the 900s cap).
    page.set_default_timeout(ACTION_TIMEOUT_MS)
    page.set_default_navigation_timeout(ACTION_TIMEOUT_MS)
    page.add_init_script(_CLIPBOARD_STUB)
    uri = Path(APP_HTML).resolve().as_uri()
    page.goto(uri)
    page.wait_for_timeout(120)
    return page


def _set_value(page, selector, value):
    page.evaluate(_SET_VALUE, [selector, str(value)])


def _add_shape(page, shape_type="circle", kind=None):
    """Pick a shape type in the toolbar, click Add, return the new shape's id."""
    sel = f'#shapePicker button[data-type="{shape_type}"]'
    if kind is not None:
        sel = f'#shapePicker button[data-type="{shape_type}"][data-kind="{kind}"]'
    page.click(sel)
    page.click("#addShapeBtn")
    page.wait_for_timeout(30)
    sid = page.evaluate(
        "() => { const el = document.querySelector('#stage .shape.selected');"
        " return el ? el.dataset.id : null; }"
    )
    if not sid:
        raise AssertionError("no selected .shape[data-id] in #stage after Add")
    return sid


def _computed(page, sid, prop):
    return page.evaluate(
        "([id, prop]) => { const el = document.querySelector(`#stage .shape[data-id=\"${id}\"]`);"
        " if (!el) return null; return getComputedStyle(el)[prop]; }",
        [sid, prop],
    )


def _px(value):
    try:
        return float(str(value).replace("px", "").split()[0])
    except (ValueError, IndexError, AttributeError):
        return None


def _num(value):
    """Leading numeric magnitude of a computed value, unit-agnostic ('64px',
    '40%', '250' -> 64.0 / 40.0 / 250.0)."""
    m = re.match(r"\s*(-?\d+(?:\.\d+)?)", str(value))
    return float(m.group(1)) if m else None


def _int(value):
    try:
        return int(str(value))
    except (ValueError, TypeError):
        return None


def _shape_text(page, sid):
    """Return #cssOutput text after selecting shape `sid`."""
    return page.text_content("#cssOutput") or ""


# ---------------------------------------------------------------------------
# Feature checks. Each takes a fresh page and returns (ok: bool, detail: str).
# ---------------------------------------------------------------------------
def _is_rendered_shape(page, sid):
    """True if the shape has a visible non-rectangular rendering by *any*
    mechanism -- clip-path OR border-radius. instruction.md mandates clip-path
    only for inset + polygon; circle/ellipse rendering is left to the agent, so
    accept a rounded div too (border-radius) rather than over-specifying."""
    clip = (_computed(page, sid, "clipPath") or "none").strip()
    br = (_computed(page, sid, "borderRadius") or "0px").strip()
    return clip not in ("", "none") or br not in ("", "0px", "0")


def check_add_shape(page):
    sid = _add_shape(page, "circle")
    n = page.evaluate("() => document.querySelectorAll('#stage .shape[data-id]').length")
    layers = page.evaluate("() => document.querySelectorAll('#layersList [data-id]').length")
    rendered = _is_rendered_shape(page, sid)
    clip = _computed(page, sid, "clipPath")
    ok = n >= 1 and layers >= 1 and rendered
    return ok, f"shapes={n} layers={layers} rendered={rendered} clip-path={clip!r}"


def _check_shape_kind(page, shape_type, kind, prefix):
    sid = _add_shape(page, shape_type, kind)
    clip = (_computed(page, sid, "clipPath") or "").strip()
    ok = clip.startswith(prefix)
    label = kind or shape_type
    return ok, f"{label} clip-path={clip!r} (expect {prefix}...)"


def check_shape_ellipse(page):
    # instruction.md maps only inset + polygon to clip-path; the ellipse render
    # mechanism is unspecified, so accept clip-path: ellipse(...) OR a rounded div.
    sid = _add_shape(page, "ellipse")
    clip = (_computed(page, sid, "clipPath") or "").strip()
    br = (_computed(page, sid, "borderRadius") or "0px").strip()
    ok = clip.startswith("ellipse(") or br not in ("", "0px", "0")
    return ok, f"ellipse clip-path={clip!r} border-radius={br!r} (expect ellipse(...) or rounded)"


def check_shape_inset(page):
    return _check_shape_kind(page, "inset", None, "inset(")


def check_shape_polygon_triangle(page):
    return _check_shape_kind(page, "polygon", "triangle", "polygon(")


def check_shape_polygon_star(page):
    return _check_shape_kind(page, "polygon", "star", "polygon(")


def check_shape_polygon_pentagon(page):
    return _check_shape_kind(page, "polygon", "pentagon", "polygon(")


def check_shape_polygon_hexagon(page):
    return _check_shape_kind(page, "polygon", "hexagon", "polygon(")


def check_shape_polygon_custom(page):
    return _check_shape_kind(page, "polygon", "custom", "polygon(")


def check_drag(page):
    # Drag-to-move on #stage (instruction: "Canvas: drag-to-move"). Use an inset
    # (rectangle) so the grab point -- the centre of the shape box -- has no
    # vertex/resize handle over it, making the gesture a pure move. Driven with
    # real pointer events via page.mouse (not the input-value helper), so this
    # exercises the canvas drag handler, not the #xInput/#yInput path.
    sid = _add_shape(page, "inset")
    sel = f'#stage .shape[data-id="{sid}"]'
    x0 = _px(_computed(page, sid, "left"))
    y0 = _px(_computed(page, sid, "top"))
    box = page.locator(sel).bounding_box()
    if not box or x0 is None or y0 is None:
        return False, f"no starting geometry (box={box}, left={x0}, top={y0})"
    cx = box["x"] + box["width"] / 2
    cy = box["y"] + box["height"] / 2
    dx, dy = 90, 60
    page.mouse.move(cx, cy)
    page.mouse.down()
    page.mouse.move(cx + dx / 2, cy + dy / 2, steps=4)
    page.mouse.move(cx + dx, cy + dy, steps=4)
    page.mouse.up()
    page.wait_for_timeout(50)
    x1 = _px(_computed(page, sid, "left"))
    y1 = _px(_computed(page, sid, "top"))
    ok = (
        x1 is not None and y1 is not None
        and abs((x1 - x0) - dx) <= 6 and abs((y1 - y0) - dy) <= 6
    )
    return ok, f"drag by ({dx},{dy}): left {x0}->{x1} top {y0}->{y1} (expect +{dx}/+{dy})"


def check_move(page):
    sid = _add_shape(page, "circle")
    _set_value(page, "#xInput", 320)
    _set_value(page, "#yInput", 240)
    page.wait_for_timeout(30)
    left = _px(_computed(page, sid, "left"))
    top = _px(_computed(page, sid, "top"))
    ok = left is not None and top is not None and abs(left - 320) <= TOL and abs(top - 240) <= TOL
    return ok, f"left={left} top={top} (expect 320/240)"


def check_rotate(page):
    sid = _add_shape(page, "circle")
    _set_value(page, "#rotationInput", 45)
    page.wait_for_timeout(30)
    angle = page.evaluate(
        "(id) => { const el = document.querySelector(`#stage .shape[data-id=\"${id}\"]`);"
        " if (!el) return null; const t = getComputedStyle(el).transform;"
        " if (!t || t === 'none') return null; const m = t.match(/matrix\\(([^)]+)\\)/);"
        " if (!m) return null; const p = m[1].split(',').map(Number);"
        " return Math.round(Math.atan2(p[1], p[0]) * 180 / Math.PI); }",
        sid,
    )
    ok = angle is not None and abs(((angle - 45 + 180) % 360) - 180) <= 3
    return ok, f"rendered rotation={angle}deg (expect ~45)"


def check_resize(page):
    sid = _add_shape(page, "circle")
    _set_value(page, "#wInput", 250)
    _set_value(page, "#hInput", 120)
    page.wait_for_timeout(30)
    w = _px(_computed(page, sid, "width"))
    h = _px(_computed(page, sid, "height"))
    ok = w is not None and h is not None and abs(w - 250) <= TOL and abs(h - 120) <= TOL
    return ok, f"width={w} height={h} (expect 250/120)"


def check_recolor(page):
    sid = _add_shape(page, "circle")
    page.evaluate(
        "(id) => { const inp = document.querySelector(`#layersList [data-id=\"${id}\"] input[type=\"color\"]`);"
        " if (!inp) throw new Error('no layer colour input'); inp.value = '#ff0000';"
        " inp.dispatchEvent(new Event('input', { bubbles: true }));"
        " inp.dispatchEvent(new Event('change', { bubbles: true })); }",
        sid,
    )
    page.wait_for_timeout(30)
    bg = _computed(page, sid, "backgroundColor")
    ok = bg is not None and bg.replace(" ", "") == "rgb(255,0,0)"
    return ok, f"background-color={bg!r} (expect rgb(255, 0, 0))"


def check_opacity(page):
    sid = _add_shape(page, "circle")
    _set_value(page, f'#layersList [data-id="{sid}"] input[type="range"]', 0.3)
    page.wait_for_timeout(30)
    op = _num(_computed(page, sid, "opacity"))
    ok = op is not None and abs(op - 0.3) <= 0.05
    return ok, f"opacity={op} (expect ~0.3 after layer range=0.3)"


def check_visibility(page):
    # Layer-row visibility checkbox hides the shape. Accept any standard "hidden"
    # rendering -- display:none, visibility:hidden, or opacity 0 -- so the check
    # does not over-specify HOW the shape is hidden.
    sid = _add_shape(page, "circle")
    page.evaluate(
        "(id) => { const cb = document.querySelector(`#layersList [data-id=\"${id}\"] input[type=\"checkbox\"]`);"
        " if (!cb) throw new Error('no layer visibility checkbox'); cb.checked = false;"
        " cb.dispatchEvent(new Event('input', { bubbles: true }));"
        " cb.dispatchEvent(new Event('change', { bubbles: true })); }",
        sid,
    )
    page.wait_for_timeout(30)
    disp = _computed(page, sid, "display")
    vis = _computed(page, sid, "visibility")
    op = _num(_computed(page, sid, "opacity"))
    ok = disp == "none" or vis == "hidden" or (op is not None and op <= 0.01)
    return ok, f"after uncheck visibility: display={disp!r} visibility={vis!r} opacity={op} (expect hidden)"


def check_reorder_front(page):
    id_a = _add_shape(page, "circle")   # added first  -> back  (z=0)
    id_b = _add_shape(page, "inset")    # added second -> front (z=1)
    page.click(f'#layersList [data-id="{id_a}"] button[data-action="front"]')
    page.wait_for_timeout(30)
    z_a = _int(_computed(page, id_a, "zIndex"))
    z_b = _int(_computed(page, id_b, "zIndex"))
    ok = z_a is not None and z_b is not None and z_a > z_b
    return ok, f"bring A to front: z(A)={z_a} z(B)={z_b} (expect A>B)"


def check_reorder_back(page):
    id_a = _add_shape(page, "circle")   # z=0
    id_b = _add_shape(page, "inset")    # z=1 (front)
    page.click(f'#layersList [data-id="{id_b}"] button[data-action="back"]')
    page.wait_for_timeout(30)
    z_a = _int(_computed(page, id_a, "zIndex"))
    z_b = _int(_computed(page, id_b, "zIndex"))
    ok = z_a is not None and z_b is not None and z_b < z_a
    return ok, f"send B to back: z(A)={z_a} z(B)={z_b} (expect B<A)"


def check_reorder_forward(page):
    # instruction.md only says forward "moves a shape up one step" -- it does not
    # pin the z-index numbering base, so assert RELATIVE order, not exact z values.
    # Stack bottom->top: A, B, C. Forward A once -> B, A, C (A above B, below C).
    id_a = _add_shape(page, "circle")    # bottom
    id_b = _add_shape(page, "ellipse")   # middle
    id_c = _add_shape(page, "inset")     # top
    page.click(f'#layersList [data-id="{id_a}"] button[data-action="forward"]')
    page.wait_for_timeout(30)
    z_a = _int(_computed(page, id_a, "zIndex"))
    z_b = _int(_computed(page, id_b, "zIndex"))
    z_c = _int(_computed(page, id_c, "zIndex"))
    ok = None not in (z_a, z_b, z_c) and z_b < z_a < z_c
    return ok, f"forward A one step: z(A)={z_a} z(B)={z_b} z(C)={z_c} (expect B<A<C)"


def check_reorder_backward(page):
    # Relative assertion (see check_reorder_forward). Stack bottom->top: A, B, C.
    # Backward C once -> A, C, B (C above A, below B).
    id_a = _add_shape(page, "circle")    # bottom
    id_b = _add_shape(page, "ellipse")   # middle
    id_c = _add_shape(page, "inset")     # top
    page.click(f'#layersList [data-id="{id_c}"] button[data-action="backward"]')
    page.wait_for_timeout(30)
    z_a = _int(_computed(page, id_a, "zIndex"))
    z_b = _int(_computed(page, id_b, "zIndex"))
    z_c = _int(_computed(page, id_c, "zIndex"))
    ok = None not in (z_a, z_b, z_c) and z_a < z_c < z_b
    return ok, f"backward C one step: z(A)={z_a} z(B)={z_b} z(C)={z_c} (expect A<C<B)"


def check_delete(page):
    id_a = _add_shape(page, "circle")
    _add_shape(page, "inset")
    page.click(f'#layersList [data-id="{id_a}"] button[data-action="delete"]')
    page.wait_for_timeout(30)
    shapes = page.evaluate("() => document.querySelectorAll('#stage .shape[data-id]').length")
    layers = page.evaluate("() => document.querySelectorAll('#layersList [data-id]').length")
    gone = page.evaluate(
        "(id) => !document.querySelector(`#stage .shape[data-id=\"${id}\"]`)", id_a
    )
    ok = shapes == 1 and layers == 1 and bool(gone)
    return ok, f"after delete A: shapes={shapes} layers={layers} A_gone={gone} (expect 1/1/True)"


def check_corner_round(page):
    # Corner rounding is routed through the INSET clip-path `round`, driven by
    # #borderRadiusSlider (per instruction.md "Inset = Rectangle Mapping") -- NOT
    # the CSS border-radius prop. Asserted on the rendered clip-path only; the
    # instruction doesn't pin what #cssOutput enumerates, so it's not required here.
    sid = _add_shape(page, "inset")
    _set_value(page, "#borderRadiusSlider", 30)
    page.wait_for_timeout(30)
    clip = (_computed(page, sid, "clipPath") or "")
    m = re.search(r"round\s+([\d.]+)", clip)
    r = float(m.group(1)) if m else None
    ok = clip.strip().startswith("inset(") and "round" in clip and r is not None and abs(r - 30) <= TOL
    return ok, f"inset clip-path={clip!r} round={r} (expect inset(... round 30%))"


def check_css_output(page):
    # instruction.md only calls #cssOutput "the selected shape's live CSS" without
    # enumerating fields, so assert the minimum fair contract: it is non-empty and
    # reflects the shape's clip-path (an inset here, whose clip-path IS specified).
    # Not asserting exact width/height fields (flagged: Output Ambiguity).
    sid = _add_shape(page, "inset")
    _set_value(page, "#wInput", 200)
    _set_value(page, "#hInput", 100)
    page.wait_for_timeout(30)
    out = page.text_content("#cssOutput") or ""
    norm = re.sub(r"\s+", " ", out).lower()
    ok = bool(norm.strip()) and "clip-path" in norm and "inset(" in norm
    return ok, f"cssOutput={out!r} (expect non-empty, contains clip-path + inset(...))"


def check_copy_css(page):
    sid = _add_shape(page, "circle")
    out = (page.text_content("#cssOutput") or "").strip()
    page.click("#copyCssBtn")
    page.wait_for_timeout(60)
    copied = (page.evaluate("() => window.__copied") or "").strip()
    ok = bool(out) and copied == out and "clip-path" in copied
    return ok, f"clipboard writeText matched cssOutput={copied == out} (copied len {len(copied)})"


CHECKS = [
    ("add_shape", check_add_shape),
    ("shape_ellipse", check_shape_ellipse),
    ("shape_inset", check_shape_inset),
    ("shape_polygon_triangle", check_shape_polygon_triangle),
    ("shape_polygon_star", check_shape_polygon_star),
    ("shape_polygon_pentagon", check_shape_polygon_pentagon),
    ("shape_polygon_hexagon", check_shape_polygon_hexagon),
    ("shape_polygon_custom", check_shape_polygon_custom),
    ("move", check_move),
    ("drag", check_drag),
    ("rotate", check_rotate),
    ("resize", check_resize),
    ("recolor", check_recolor),
    ("opacity", check_opacity),
    ("visibility", check_visibility),
    ("reorder_front", check_reorder_front),
    ("reorder_back", check_reorder_back),
    ("reorder_forward", check_reorder_forward),
    ("reorder_backward", check_reorder_backward),
    ("delete", check_delete),
    ("corner_round", check_corner_round),
    ("css_output", check_css_output),
    ("copy_css", check_copy_css),
]


def compute(force: bool = False) -> dict:
    """Run every feature check once (fresh page each) and cache the result dict:
    {checks: {name: {ok, detail}}, passed, total, reward}."""
    if not force and os.path.exists(RESULT_CACHE):
        with open(RESULT_CACHE) as fh:
            return json.load(fh)

    result = {"checks": {}, "passed": 0, "total": len(CHECKS), "reward": 0.0,
              "load_error": None}

    if not os.path.exists(APP_HTML):
        result["load_error"] = "/app/index.html not found"
        for name, _ in CHECKS:
            result["checks"][name] = {"ok": False, "detail": "app not built"}
        _cache(result)
        return result

    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        # Use the Chromium pre-baked in the Playwright base image (see
        # environment/Dockerfile): CHROMIUM_PATH is left unset, so Playwright
        # launches its managed, version-matched browser from /ms-playwright -- no
        # verify-time download from the (blocked) Playwright CDN. executable_path
        # is only set if CHROMIUM_PATH is provided (e.g. a dev box pointing at a
        # system Chromium); otherwise the managed browser is used.
        _chromium_path = os.environ.get("CHROMIUM_PATH")
        _launch_kwargs = {"args": LAUNCH_ARGS}
        if _chromium_path:
            _launch_kwargs["executable_path"] = _chromium_path
        browser = p.chromium.launch(**_launch_kwargs)
        for name, fn in CHECKS:
            page = None
            try:
                page = _new_page(browser)
                ok, detail = fn(page)
            except Exception as exc:  # a broken feature must score 0, not crash grading
                ok, detail = False, f"error: {exc}"
            finally:
                if page is not None:
                    page.close()
            result["checks"][name] = {"ok": bool(ok), "detail": detail}
            if ok:
                result["passed"] += 1
        browser.close()

    result["reward"] = round(result["passed"] / result["total"], 6)
    _cache(result)
    return result


def _cache(result: dict) -> None:
    try:
        with open(RESULT_CACHE, "w") as fh:
            json.dump(result, fh)
    except OSError:
        pass
