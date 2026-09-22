(() => {
  'use strict';

  // ---------- Utilities ----------
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const r2 = (n) => Math.round(n * 100) / 100;
  let nextId = 1;
  const uid = () => `shape-${nextId++}`;

  const PALETTE = ['#4f8ef7', '#f76c6c', '#57c785', '#f7b84f', '#a06cf7', '#3ec6d9', '#f76ca0'];
  let colorIndex = 0;
  const nextColor = () => PALETTE[colorIndex++ % PALETTE.length];

  function regularPolygon(sides, cx, cy, radius, rotationDeg = -90) {
    const points = [];
    for (let i = 0; i < sides; i++) {
      const angle = (rotationDeg + (i * 360) / sides) * (Math.PI / 180);
      points.push({ x: r2(cx + radius * Math.cos(angle)), y: r2(cy + radius * Math.sin(angle)) });
    }
    return points;
  }

  function starPoints(cx = 50, cy = 50, outerR = 45, innerR = 18) {
    const points = [];
    for (let i = 0; i < 10; i++) {
      const radius = i % 2 === 0 ? outerR : innerR;
      const angle = (-90 + i * 36) * (Math.PI / 180);
      points.push({ x: r2(cx + radius * Math.cos(angle)), y: r2(cy + radius * Math.sin(angle)) });
    }
    return points;
  }

  // ---------- Shape geometry defaults ----------
  function defaultGeometry(type, kind) {
    switch (type) {
      case 'circle':
        return { cx: 50, cy: 50, r: 40 };
      case 'ellipse':
        return { cx: 50, cy: 50, rx: 45, ry: 30 };
      case 'inset':
        return { top: 10, right: 10, bottom: 10, left: 10, radius: 0 };
      case 'polygon':
        switch (kind) {
          case 'triangle':
            return { points: [{ x: 50, y: 5 }, { x: 95, y: 95 }, { x: 5, y: 95 }] };
          case 'pentagon':
            return { points: regularPolygon(5, 50, 50, 45) };
          case 'hexagon':
            return { points: regularPolygon(6, 50, 50, 45, -90) };
          case 'star':
            return { points: starPoints() };
          case 'custom':
          default:
            return { points: [{ x: 50, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }] };
        }
      default:
        return {};
    }
  }

  // ---------- clip-path generation ----------
  function clipPathFor(shape) {
    const g = shape.geometry;
    switch (shape.type) {
      case 'circle':
        return `circle(${r2(g.r)}% at ${r2(g.cx)}% ${r2(g.cy)}%)`;
      case 'ellipse':
        return `ellipse(${r2(g.rx)}% ${r2(g.ry)}% at ${r2(g.cx)}% ${r2(g.cy)}%)`;
      case 'inset': {
        const roundPart = g.radius > 0 ? ` round ${r2(g.radius)}%` : '';
        return `inset(${r2(g.top)}% ${r2(g.right)}% ${r2(g.bottom)}% ${r2(g.left)}%${roundPart})`;
      }
      case 'polygon':
        return `polygon(${g.points.map((p) => `${r2(p.x)}% ${r2(p.y)}%`).join(', ')})`;
      default:
        return 'none';
    }
  }

  // ---------- Vertex handle descriptors (percentages within the shape box) ----------
  function getVertexHandles(shape) {
    const g = shape.geometry;
    switch (shape.type) {
      case 'circle':
        return [
          { handle: 'center', x: g.cx, y: g.cy },
          { handle: 'radius', x: clamp(g.cx + g.r, -50, 150), y: g.cy },
        ];
      case 'ellipse':
        return [
          { handle: 'center', x: g.cx, y: g.cy },
          { handle: 'rx', x: clamp(g.cx + g.rx, -50, 150), y: g.cy },
          { handle: 'ry', x: g.cx, y: clamp(g.cy + g.ry, -50, 150) },
        ];
      case 'inset':
        return [
          { handle: 'top', x: 50, y: g.top, axis: 'y' },
          { handle: 'right', x: 100 - g.right, y: 50, axis: 'x' },
          { handle: 'bottom', x: 50, y: 100 - g.bottom, axis: 'y' },
          { handle: 'left', x: g.left, y: 50, axis: 'x' },
          { handle: 'corner-radius', x: clamp(g.left + g.radius, 0, 50), y: clamp(g.top + g.radius, 0, 50) },
        ];
      case 'polygon':
        return g.points.map((p, i) => ({ handle: `point-${i}`, x: p.x, y: p.y }));
      default:
        return [];
    }
  }

  function updateVertexGeometry(shape, handleName, pct) {
    const g = shape.geometry;
    switch (shape.type) {
      case 'circle':
        if (handleName === 'center') {
          g.cx = r2(pct.x);
          g.cy = r2(pct.y);
        } else if (handleName === 'radius') {
          g.r = r2(clamp(Math.hypot(pct.x - g.cx, pct.y - g.cy), 1, 150));
        }
        break;
      case 'ellipse':
        if (handleName === 'center') {
          g.cx = r2(pct.x);
          g.cy = r2(pct.y);
        } else if (handleName === 'rx') {
          g.rx = r2(clamp(Math.abs(pct.x - g.cx), 1, 150));
        } else if (handleName === 'ry') {
          g.ry = r2(clamp(Math.abs(pct.y - g.cy), 1, 150));
        }
        break;
      case 'inset':
        if (handleName === 'top') {
          g.top = r2(clamp(pct.y, 0, 100 - g.bottom - 1));
        } else if (handleName === 'bottom') {
          g.bottom = r2(clamp(100 - pct.y, 0, 100 - g.top - 1));
        } else if (handleName === 'left') {
          g.left = r2(clamp(pct.x, 0, 100 - g.right - 1));
        } else if (handleName === 'right') {
          g.right = r2(clamp(100 - pct.x, 0, 100 - g.left - 1));
        } else if (handleName === 'corner-radius') {
          g.radius = r2(clamp((pct.x - g.left + (pct.y - g.top)) / 2, 0, 50));
        }
        break;
      case 'polygon':
        if (handleName.startsWith('point-')) {
          const idx = Number(handleName.split('-')[1]);
          if (g.points[idx]) g.points[idx] = { x: r2(pct.x), y: r2(pct.y) };
        }
        break;
    }
  }

  // ---------- App state ----------
  const state = {
    shapes: [],
    selectedId: null,
    addPointMode: false,
  };
  let currentPick = { type: 'circle', kind: undefined };

  const getShape = (id) => state.shapes.find((s) => s.id === id);

  // ---------- DOM refs ----------
  const stageWrap = document.getElementById('stage-wrap');
  const stage = document.getElementById('stage');
  const overlay = document.getElementById('overlay');
  const layersList = document.getElementById('layersList');
  const layersEmptyHint = document.getElementById('layersEmptyHint');
  const shapeSettings = document.getElementById('shapeSettings');
  const xInput = document.getElementById('xInput');
  const yInput = document.getElementById('yInput');
  const wInput = document.getElementById('wInput');
  const hInput = document.getElementById('hInput');
  const rotationInput = document.getElementById('rotationInput');
  const borderRadiusRow = document.getElementById('borderRadiusRow');
  const borderRadiusSlider = document.getElementById('borderRadiusSlider');
  const borderRadiusValue = document.getElementById('borderRadiusValue');
  const cssOutput = document.getElementById('cssOutput');
  const shapePicker = document.getElementById('shapePicker');
  const addShapeBtn = document.getElementById('addShapeBtn');
  const addPointModeBtn = document.getElementById('addPointModeBtn');
  const copyCssBtn = document.getElementById('copyCssBtn');

  const RESIZE_DEFS = [
    { handle: 'nw', x: 0, y: 0 }, { handle: 'n', x: 0.5, y: 0 }, { handle: 'ne', x: 1, y: 0 },
    { handle: 'w', x: 0, y: 0.5 }, { handle: 'e', x: 1, y: 0.5 },
    { handle: 'sw', x: 0, y: 1 }, { handle: 's', x: 0.5, y: 1 }, { handle: 'se', x: 1, y: 1 },
  ];

  // ---------- Rendering ----------
  function updateShapeStyle(el, shape) {
    el.style.left = `${shape.x}px`;
    el.style.top = `${shape.y}px`;
    el.style.width = `${shape.w}px`;
    el.style.height = `${shape.h}px`;
    el.style.background = shape.fill;
    el.style.opacity = shape.opacity;
    el.style.clipPath = clipPathFor(shape);
    el.style.transform = shape.rotation ? `rotate(${shape.rotation}deg)` : '';
    el.style.display = shape.visible ? '' : 'none';
  }

  function updateHitStyle(el, shape) {
    el.style.left = `${shape.x}px`;
    el.style.top = `${shape.y}px`;
    el.style.width = `${shape.w}px`;
    el.style.height = `${shape.h}px`;
    el.style.transform = shape.rotation ? `rotate(${shape.rotation}deg)` : '';
    el.style.display = shape.visible ? '' : 'none';
  }

  function renderStage() {
    stage.innerHTML = '';
    if (state.shapes.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'stage-hint';
      hint.textContent = 'Add a shape from the toolbar to get started.';
      stage.appendChild(hint);
      return;
    }
    state.shapes.forEach((shape, index) => {
      const el = document.createElement('div');
      el.className = 'shape' + (shape.id === state.selectedId ? ' selected' : '');
      el.dataset.id = shape.id;
      el.style.zIndex = String(index);
      updateShapeStyle(el, shape);
      stage.appendChild(el);

      const hit = document.createElement('div');
      hit.className = 'shape-hit';
      hit.dataset.id = shape.id;
      hit.style.zIndex = String(index);
      updateHitStyle(hit, shape);
      stage.appendChild(hit);
    });
  }

  const ROTATE_HANDLE_OFFSET = 28;

  function renderOverlay() {
    overlay.innerHTML = '';
    const shape = getShape(state.selectedId);
    if (!shape) return;

    const group = document.createElement('div');
    group.className = 'overlay-group';
    group.style.position = 'absolute';
    group.style.top = '0';
    group.style.left = '0';
    group.style.width = '100%';
    group.style.height = '100%';
    const cx = shape.x + shape.w / 2;
    const cy = shape.y + shape.h / 2;
    group.style.transformOrigin = `${cx}px ${cy}px`;
    group.style.transform = shape.rotation ? `rotate(${shape.rotation}deg)` : '';
    overlay.appendChild(group);

    const outline = document.createElement('div');
    outline.className = 'selection-outline';
    outline.style.left = `${shape.x}px`;
    outline.style.top = `${shape.y}px`;
    outline.style.width = `${shape.w}px`;
    outline.style.height = `${shape.h}px`;
    group.appendChild(outline);

    RESIZE_DEFS.forEach((d) => {
      const el = document.createElement('div');
      el.className = `handle resize-handle handle-${d.handle}`;
      el.dataset.kind = 'resize';
      el.dataset.handle = d.handle;
      el.style.left = `${shape.x + d.x * shape.w}px`;
      el.style.top = `${shape.y + d.y * shape.h}px`;
      group.appendChild(el);
    });

    getVertexHandles(shape).forEach((v) => {
      const el = document.createElement('div');
      el.className = 'handle vertex-handle' + (v.axis ? ` axis-${v.axis}` : '');
      el.dataset.kind = 'vertex';
      el.dataset.handle = v.handle;
      el.style.left = `${shape.x + (v.x / 100) * shape.w}px`;
      el.style.top = `${shape.y + (v.y / 100) * shape.h}px`;
      group.appendChild(el);
    });

    const rotateHandle = document.createElement('div');
    rotateHandle.className = 'handle rotate-handle';
    rotateHandle.dataset.kind = 'rotate';
    rotateHandle.style.left = `${cx}px`;
    rotateHandle.style.top = `${shape.y - ROTATE_HANDLE_OFFSET}px`;
    group.appendChild(rotateHandle);
  }

  function updateOverlayPositions() {
    const shape = getShape(state.selectedId);
    if (!shape) return;
    const cx = shape.x + shape.w / 2;
    const cy = shape.y + shape.h / 2;
    const group = overlay.querySelector('.overlay-group');
    if (group) {
      group.style.transformOrigin = `${cx}px ${cy}px`;
      group.style.transform = shape.rotation ? `rotate(${shape.rotation}deg)` : '';
    }
    const outline = overlay.querySelector('.selection-outline');
    if (outline) {
      outline.style.left = `${shape.x}px`;
      outline.style.top = `${shape.y}px`;
      outline.style.width = `${shape.w}px`;
      outline.style.height = `${shape.h}px`;
    }
    overlay.querySelectorAll('.resize-handle').forEach((el) => {
      const d = RESIZE_DEFS.find((rd) => rd.handle === el.dataset.handle);
      if (!d) return;
      el.style.left = `${shape.x + d.x * shape.w}px`;
      el.style.top = `${shape.y + d.y * shape.h}px`;
    });
    const vhandles = getVertexHandles(shape);
    overlay.querySelectorAll('.vertex-handle').forEach((el, i) => {
      const v = vhandles[i];
      if (!v) return;
      el.style.left = `${shape.x + (v.x / 100) * shape.w}px`;
      el.style.top = `${shape.y + (v.y / 100) * shape.h}px`;
    });
    const rotateHandle = overlay.querySelector('.rotate-handle');
    if (rotateHandle) {
      rotateHandle.style.left = `${cx}px`;
      rotateHandle.style.top = `${shape.y - ROTATE_HANDLE_OFFSET}px`;
    }
  }

  function renderLayers() {
    layersList.innerHTML = '';
    layersEmptyHint.style.display = state.shapes.length === 0 ? '' : 'none';
    const display = [...state.shapes].reverse(); // front-to-back
    display.forEach((shape) => {
      const li = document.createElement('li');
      li.dataset.id = shape.id;
      li.draggable = true;
      if (shape.id === state.selectedId) li.classList.add('selected');

      const color = document.createElement('input');
      color.type = 'color';
      color.value = shape.fill;
      li.appendChild(color);

      const name = document.createElement('span');
      name.className = 'layer-name';
      name.textContent = shape.kind ? shape.kind : shape.type;
      li.appendChild(name);

      const opacity = document.createElement('input');
      opacity.type = 'range';
      opacity.min = '0';
      opacity.max = '1';
      opacity.step = '0.05';
      opacity.value = String(shape.opacity);
      li.appendChild(opacity);

      const opacityLabel = document.createElement('span');
      opacityLabel.className = 'opacity-label';
      opacityLabel.textContent = shape.opacity.toFixed(2);
      li.appendChild(opacityLabel);

      const visibility = document.createElement('input');
      visibility.type = 'checkbox';
      visibility.checked = shape.visible;
      visibility.title = 'Toggle visibility';
      li.appendChild(visibility);

      const forwardBtn = document.createElement('button');
      forwardBtn.textContent = '▲';
      forwardBtn.title = 'Bring forward';
      forwardBtn.dataset.action = 'forward';
      li.appendChild(forwardBtn);

      const backwardBtn = document.createElement('button');
      backwardBtn.textContent = '▼';
      backwardBtn.title = 'Send backward';
      backwardBtn.dataset.action = 'backward';
      li.appendChild(backwardBtn);

      const frontBtn = document.createElement('button');
      frontBtn.textContent = '⤒';
      frontBtn.title = 'Bring to front';
      frontBtn.dataset.action = 'front';
      li.appendChild(frontBtn);

      const backBtn = document.createElement('button');
      backBtn.textContent = '⤓';
      backBtn.title = 'Send to back';
      backBtn.dataset.action = 'back';
      li.appendChild(backBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = '✕';
      deleteBtn.title = 'Delete';
      deleteBtn.className = 'danger';
      deleteBtn.dataset.action = 'delete';
      li.appendChild(deleteBtn);

      layersList.appendChild(li);
    });
  }

  function renderCssPanel() {
    const shape = getShape(state.selectedId);
    if (!shape) {
      cssOutput.textContent = 'Select a shape to see its CSS.';
      return;
    }
    const css = [
      '.shape {',
      '  position: absolute;',
      `  left: ${Math.round(shape.x)}px;`,
      `  top: ${Math.round(shape.y)}px;`,
      `  width: ${Math.round(shape.w)}px;`,
      `  height: ${Math.round(shape.h)}px;`,
      `  background: ${shape.fill};`,
      `  opacity: ${shape.opacity};`,
      `  transform: rotate(${shape.rotation || 0}deg);`,
      `  clip-path: ${clipPathFor(shape)};`,
      '}',
    ].join('\n');
    cssOutput.textContent = css;
  }

  function updateAddPointModeButton() {
    const shape = getShape(state.selectedId);
    const isCustomPolygon = shape && shape.type === 'polygon' && shape.kind === 'custom';
    addPointModeBtn.hidden = !isCustomPolygon;
    if (!isCustomPolygon) state.addPointMode = false;
    addPointModeBtn.classList.toggle('active', state.addPointMode);
  }

  function updateShapeSettingsPanel() {
    const shape = getShape(state.selectedId);
    if (!shape) {
      shapeSettings.hidden = true;
      return;
    }
    shapeSettings.hidden = false;
    xInput.value = Math.round(shape.x);
    yInput.value = Math.round(shape.y);
    wInput.value = Math.round(shape.w);
    hInput.value = Math.round(shape.h);
    rotationInput.value = Math.round(shape.rotation || 0);
    // Corner rounding applies only to inset (rectangle) shapes; #borderRadiusSlider
    // drives the inset clip-path `round` value (per instruction.md). Hidden for
    // circle/ellipse/polygon, which have no border-radius mapping.
    borderRadiusRow.hidden = shape.type !== 'inset';
    if (shape.type === 'inset') {
      borderRadiusSlider.value = String(shape.geometry.radius);
      borderRadiusValue.textContent = `${shape.geometry.radius}%`;
    }
  }

  function render() {
    renderStage();
    renderOverlay();
    renderLayers();
    renderCssPanel();
    updateAddPointModeButton();
    updateShapeSettingsPanel();
  }

  // ---------- Selection / mutation ----------
  function selectShape(id) {
    state.selectedId = id;
    render();
  }

  function deselect() {
    state.selectedId = null;
    render();
  }

  function addShape(type, kind) {
    const w = 160, h = 160;
    const sw = Math.max(stage.clientWidth, 800);
    const sh = Math.max(stage.clientHeight, 600);
    const shape = {
      id: uid(),
      type,
      kind,
      x: Math.max(20, (sw - w) / 2),
      y: Math.max(20, (sh - h) / 2),
      w,
      h,
      fill: nextColor(),
      opacity: 1,
      visible: true,
      rotation: 0,
      geometry: defaultGeometry(type, kind),
    };
    state.shapes.push(shape);
    state.selectedId = shape.id;
    render();
  }

  function deleteShape(id) {
    state.shapes = state.shapes.filter((s) => s.id !== id);
    if (state.selectedId === id) state.selectedId = null;
    render();
  }

  function moveShape(id, delta) {
    const idx = state.shapes.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const newIdx = clamp(idx + delta, 0, state.shapes.length - 1);
    if (newIdx === idx) return;
    const [s] = state.shapes.splice(idx, 1);
    state.shapes.splice(newIdx, 0, s);
    render();
  }

  function moveToFront(id) {
    const idx = state.shapes.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const [s] = state.shapes.splice(idx, 1);
    state.shapes.push(s);
    render();
  }

  function moveToBack(id) {
    const idx = state.shapes.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const [s] = state.shapes.splice(idx, 1);
    state.shapes.unshift(s);
    render();
  }

  function reorderByDisplayIds(draggedId, targetId) {
    const display = [...state.shapes].reverse().map((s) => s.id); // front-to-back
    const from = display.indexOf(draggedId);
    const to = display.indexOf(targetId);
    if (from < 0 || to < 0) return;
    display.splice(from, 1);
    display.splice(to, 0, draggedId);
    state.shapes = display.slice().reverse().map((id) => getShape(id));
    render();
  }

  // ---------- Pointer math ----------
  function toLocalStagePoint(shape, clientX, clientY) {
    const rect = stage.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const rotation = shape.rotation || 0;
    if (!rotation) return { x: px, y: py };
    const cx = shape.x + shape.w / 2;
    const cy = shape.y + shape.h / 2;
    const rad = (-rotation * Math.PI) / 180;
    const dx = px - cx;
    const dy = py - cy;
    return {
      x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
      y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
    };
  }

  function pctFromClient(shape, clientX, clientY) {
    const local = toLocalStagePoint(shape, clientX, clientY);
    const x = ((local.x - shape.x) / shape.w) * 100;
    const y = ((local.y - shape.y) / shape.h) * 100;
    return { x: clamp(x, 0, 100), y: clamp(y, 0, 100) };
  }

  // ---------- Drag handling ----------
  let drag = null;

  function beginDrag(e, target, dragObj) {
    drag = dragObj;
    drag._target = target;
    try { target.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragEnd);
    e.preventDefault();
    e.stopPropagation();
  }

  function applyResize(shape, dragState, e) {
    const local = toLocalStagePoint(shape, e.clientX, e.clientY);
    const dx = local.x - dragState.startLocal.x;
    const dy = local.y - dragState.startLocal.y;
    const MIN = 20;
    let { x, y, w, h } = dragState.startBox;
    const handle = dragState.handle;
    if (handle.includes('e')) {
      w = Math.max(MIN, dragState.startBox.w + dx);
    }
    if (handle.includes('w')) {
      const newW = Math.max(MIN, dragState.startBox.w - dx);
      x = dragState.startBox.x + (dragState.startBox.w - newW);
      w = newW;
    }
    if (handle.includes('s')) {
      h = Math.max(MIN, dragState.startBox.h + dy);
    }
    if (handle.includes('n')) {
      const newH = Math.max(MIN, dragState.startBox.h - dy);
      y = dragState.startBox.y + (dragState.startBox.h - newH);
      h = newH;
    }
    shape.x = x;
    shape.y = y;
    shape.w = w;
    shape.h = h;
  }

  function onDragMove(e) {
    if (!drag) return;
    const shape = getShape(drag.shapeId);
    if (!shape) return;

    if (drag.type === 'move') {
      shape.x = drag.startBox.x + (e.clientX - drag.startClientX);
      shape.y = drag.startBox.y + (e.clientY - drag.startClientY);
    } else if (drag.type === 'resize') {
      applyResize(shape, drag, e);
    } else if (drag.type === 'vertex') {
      const pct = pctFromClient(shape, e.clientX, e.clientY);
      updateVertexGeometry(shape, drag.handle, pct);
    } else if (drag.type === 'rotate') {
      const rect = stage.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const cx = shape.x + shape.w / 2;
      const cy = shape.y + shape.h / 2;
      const rawAngle = (Math.atan2(py - cy, px - cx) * 180) / Math.PI;
      shape.rotation = r2(((rawAngle + 90) + 360) % 360);
    }

    const shapeEl = stage.querySelector(`.shape[data-id="${shape.id}"]`);
    if (shapeEl) updateShapeStyle(shapeEl, shape);
    const hitEl = stage.querySelector(`.shape-hit[data-id="${shape.id}"]`);
    if (hitEl) updateHitStyle(hitEl, shape);
    updateOverlayPositions();
    renderCssPanel();
    xInput.value = Math.round(shape.x);
    yInput.value = Math.round(shape.y);
    wInput.value = Math.round(shape.w);
    hInput.value = Math.round(shape.h);
    rotationInput.value = Math.round(shape.rotation || 0);
    e.preventDefault();
  }

  function onDragEnd(e) {
    if (!drag) return;
    const target = drag._target;
    try { target.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragEnd);
    drag = null;
    render();
  }

  // ---------- Stage interaction (select / move / add-point) ----------
  stage.addEventListener('pointerdown', (e) => {
    if (state.addPointMode) {
      const shape = getShape(state.selectedId);
      if (shape && shape.type === 'polygon') {
        const pct = pctFromClient(shape, e.clientX, e.clientY);
        shape.geometry.points.push({ x: pct.x, y: pct.y });
        render();
        e.preventDefault();
        return;
      }
    }
    const hitEl = e.target.closest('.shape-hit');
    if (!hitEl) {
      deselect();
      return;
    }
    const shape = getShape(hitEl.dataset.id);
    if (!shape) return;
    selectShape(shape.id);
    beginDrag(e, hitEl, {
      type: 'move',
      shapeId: shape.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startBox: { x: shape.x, y: shape.y },
    });
  });

  // ---------- Overlay interaction (resize / vertex handles) ----------
  overlay.addEventListener('pointerdown', (e) => {
    const handleEl = e.target.closest('.handle');
    if (!handleEl) return;
    const shape = getShape(state.selectedId);
    if (!shape) return;
    const kind = handleEl.dataset.kind;
    if (kind === 'resize') {
      beginDrag(e, handleEl, {
        type: 'resize',
        shapeId: shape.id,
        handle: handleEl.dataset.handle,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startBox: { x: shape.x, y: shape.y, w: shape.w, h: shape.h },
        startLocal: toLocalStagePoint(shape, e.clientX, e.clientY),
      });
    } else if (kind === 'vertex') {
      beginDrag(e, handleEl, {
        type: 'vertex',
        shapeId: shape.id,
        handle: handleEl.dataset.handle,
      });
    } else if (kind === 'rotate') {
      beginDrag(e, handleEl, {
        type: 'rotate',
        shapeId: shape.id,
      });
    }
  });

  overlay.addEventListener('contextmenu', (e) => {
    const handleEl = e.target.closest('.handle[data-kind="vertex"]');
    if (!handleEl) return;
    e.preventDefault();
    const shape = getShape(state.selectedId);
    if (!shape || shape.type !== 'polygon') return;
    const handleName = handleEl.dataset.handle;
    if (!handleName.startsWith('point-')) return;
    if (shape.geometry.points.length <= 3) return;
    const idx = Number(handleName.split('-')[1]);
    shape.geometry.points.splice(idx, 1);
    render();
  });

  // ---------- Layers panel interaction ----------
  layersList.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const id = li.dataset.id;
    const btn = e.target.closest('button[data-action]');
    if (btn) {
      const action = btn.dataset.action;
      if (action === 'forward') moveShape(id, 1);
      else if (action === 'backward') moveShape(id, -1);
      else if (action === 'front') moveToFront(id);
      else if (action === 'back') moveToBack(id);
      else if (action === 'delete') deleteShape(id);
      return;
    }
    if (e.target.closest('input')) return;
    selectShape(id);
  });

  layersList.addEventListener('input', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const shape = getShape(li.dataset.id);
    if (!shape) return;
    if (e.target.type === 'color') {
      shape.fill = e.target.value;
      const el = stage.querySelector(`.shape[data-id="${shape.id}"]`);
      if (el) updateShapeStyle(el, shape);
      renderCssPanel();
    } else if (e.target.type === 'range') {
      shape.opacity = Number(e.target.value);
      const el = stage.querySelector(`.shape[data-id="${shape.id}"]`);
      if (el) updateShapeStyle(el, shape);
      const label = li.querySelector('.opacity-label');
      if (label) label.textContent = shape.opacity.toFixed(2);
      renderCssPanel();
    }
  });

  layersList.addEventListener('change', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const shape = getShape(li.dataset.id);
    if (!shape) return;
    if (e.target.type === 'checkbox') {
      shape.visible = e.target.checked;
      const el = stage.querySelector(`.shape[data-id="${shape.id}"]`);
      if (el) updateShapeStyle(el, shape);
      if (state.selectedId === shape.id && !shape.visible) renderOverlay();
    }
  });

  layersList.addEventListener('dragstart', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    e.dataTransfer.setData('text/plain', li.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
  });

  layersList.addEventListener('dragover', (e) => {
    if (e.target.closest('li')) e.preventDefault();
  });

  layersList.addEventListener('drop', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain');
    const targetId = li.dataset.id;
    if (draggedId && draggedId !== targetId) reorderByDisplayIds(draggedId, targetId);
  });

  // ---------- Toolbar interaction ----------
  shapePicker.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-type]');
    if (!btn) return;
    currentPick = { type: btn.dataset.type, kind: btn.dataset.kind || undefined };
    shapePicker.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
  });

  addShapeBtn.addEventListener('click', () => addShape(currentPick.type, currentPick.kind));

  addPointModeBtn.addEventListener('click', () => {
    state.addPointMode = !state.addPointMode;
    addPointModeBtn.classList.toggle('active', state.addPointMode);
  });

  copyCssBtn.addEventListener('click', () => {
    const text = cssOutput.textContent;
    navigator.clipboard.writeText(text).then(() => {
      const original = copyCssBtn.textContent;
      copyCssBtn.textContent = 'Copied!';
      setTimeout(() => { copyCssBtn.textContent = original; }, 1200);
    }).catch(() => {});
  });

  // #borderRadiusSlider is the single corner-rounding control (per instruction.md):
  // for an inset (rectangle) it drives the clip-path `inset(... round X%)` value.
  // Non-inset shapes have no border-radius mapping, so it is a no-op there.
  borderRadiusSlider.addEventListener('input', (e) => {
    const shape = getShape(state.selectedId);
    if (!shape || shape.type !== 'inset') return;
    shape.geometry.radius = Number(e.target.value);
    borderRadiusValue.textContent = `${shape.geometry.radius}%`;
    const el = stage.querySelector(`.shape[data-id="${shape.id}"]`);
    if (el) updateShapeStyle(el, shape);
    updateOverlayPositions();
    renderCssPanel();
  });

  function applyPositionField(prop, value, min) {
    const shape = getShape(state.selectedId);
    if (!shape) return;
    const num = Number(value);
    if (Number.isNaN(num)) return;
    shape[prop] = min !== undefined ? Math.max(min, num) : num;
    const el = stage.querySelector(`.shape[data-id="${shape.id}"]`);
    if (el) updateShapeStyle(el, shape);
    const hitEl = stage.querySelector(`.shape-hit[data-id="${shape.id}"]`);
    if (hitEl) updateHitStyle(hitEl, shape);
    updateOverlayPositions();
    renderCssPanel();
  }

  xInput.addEventListener('input', (e) => applyPositionField('x', e.target.value));
  yInput.addEventListener('input', (e) => applyPositionField('y', e.target.value));
  wInput.addEventListener('input', (e) => applyPositionField('w', e.target.value, 20));
  hInput.addEventListener('input', (e) => applyPositionField('h', e.target.value, 20));
  rotationInput.addEventListener('input', (e) => {
    const shape = getShape(state.selectedId);
    if (!shape) return;
    const num = Number(e.target.value);
    if (Number.isNaN(num)) return;
    shape.rotation = ((num % 360) + 360) % 360;
    const el = stage.querySelector(`.shape[data-id="${shape.id}"]`);
    if (el) updateShapeStyle(el, shape);
    const hitEl = stage.querySelector(`.shape-hit[data-id="${shape.id}"]`);
    if (hitEl) updateHitStyle(hitEl, shape);
    updateOverlayPositions();
    renderCssPanel();
  });

  // ---------- Keyboard ----------
  document.addEventListener('keydown', (e) => {
    if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedId) {
      e.preventDefault();
      deleteShape(state.selectedId);
      return;
    }
    const ARROW_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (ARROW_KEYS.includes(e.key) && state.selectedId) {
      const shape = getShape(state.selectedId);
      if (!shape) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowUp') shape.y -= step;
      else if (e.key === 'ArrowDown') shape.y += step;
      else if (e.key === 'ArrowLeft') shape.x -= step;
      else if (e.key === 'ArrowRight') shape.x += step;
      const el = stage.querySelector(`.shape[data-id="${shape.id}"]`);
      if (el) updateShapeStyle(el, shape);
      const hitEl = stage.querySelector(`.shape-hit[data-id="${shape.id}"]`);
      if (hitEl) updateHitStyle(hitEl, shape);
      updateOverlayPositions();
      renderCssPanel();
      xInput.value = Math.round(shape.x);
      yInput.value = Math.round(shape.y);
    }
  });

  // ---------- Init ----------
  render();
})();
