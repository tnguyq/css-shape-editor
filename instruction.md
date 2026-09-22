# CSS Shape Builder

An app to create, arrange, and style CSS shapes on a canvas, then export the CSS.

---

## IDs

#shapePicker · #addShapeBtn · #stage · #layersList · #shapeSettings · #cssOutput · #copyCssBtn · #xInput · #yInput · #wInput · #hInput · #rotationInput · #borderRadiusSlider

Title uses class .toolbar-title (no id).

---

## Data Attributes

### data-type (shape picker options)

circle | ellipse | inset | polygon

### data-kind (polygon varieties, on picker options with data-type="polygon")

triangle | pentagon | hexagon | star | custom

### data-action (layer row buttons)

forward | backward | front | back | delete

---

## Shape Convention

Each shape on #stage is a div with class .shape and data-id="shape-N". Selected shape gets .selected. Layer rows reference shapes by matching data-id.

---

## Inset = Rectangle Mapping

Rectangles are data-type="inset" and use clip-path: inset(0 0 0 0 round X%) where X is the border-radius value from #borderRadiusSlider.

- border-radius = 0 → sharp rectangle
- border-radius = 50% of smallest dimension → pill
- Polygons (triangle, pentagon, hexagon, star, custom) use clip-path: polygon(...) and ignore border-radius

---

## Layer Row Controls

Each layer row contains:

- input[type="color"] for shape fill
- input[type="range"] for opacity (0–1)
- input[type="checkbox"] for visibility toggle
- Buttons with data-action: forward, backward, front, back, delete

---

## Shape Settings (#shapeSettings)

Number inputs for the selected shape:

- #xInput — horizontal position (left) in px
- #yInput — vertical position (top) in px
- #wInput — width in px
- #hInput — height in px
- #rotationInput — rotation in degrees (0–360)
- #borderRadiusSlider — corner rounding (range input)

---

## UI Summary

- Shape Picker (#shapePicker): choose a data-type (+ data-kind for polygons), click #addShapeBtn to add it to canvas
- Canvas (#stage): drag-to-move, click-to-select shapes
- Layers (#layersList): per-shape color, opacity, visibility, z-order buttons (data-action), delete
- Settings (#shapeSettings): position, size, rotation, border-radius via named inputs
- Output (#cssOutput): live-updating CSS; #copyCssBtn copies to clipboard
