/* ============================
   RENDER — Tree + Focus + Keyboard Navigation
   Renders projection into DOM with ARIA TreeView pattern.
   Implements keyboard-first navigation (ARIA + vim-light).
============================ */

// ─── Constants ───────────────────────────────────────────────────────────────

const OPTIONS = Object.freeze({
  SHOW_NAMED_TYPES_ON_SELECT: false,
});

const RENDER = Object.freeze({
  // Layout
  INDENT_PX: 20,
  ROW_PAD_PX: 8,

  // Glyphs
  CHEVRON_EXPANDED: "\u25BC", // ▼
  CHEVRON_COLLAPSED: "\u25B6", // ▶
  CHEVRON_NONE: "\u00A0", // non-breaking space (invisible placeholder)

  // Labels
  LABEL_RECORD: "record",
  LABEL_ENUM: "enum",
  LABEL_FIXED: "fixed",
  LABEL_ARRAY: "array",
  LABEL_MAP: "map",
  LABEL_UNION: "union",
  LABEL_UNKNOWN: "?",
  LABEL_FIELD_DEFAULT: "field",
  LABEL_RECORD_DEFAULT: "Record",
  LABEL_ENUM_DEFAULT: "Enum",
  LABEL_FIXED_DEFAULT: "Fixed",

  // Badges (max branches shown inline)
  UNION_INLINE_MAX: 3,

  // Action buttons
  BTN_ADD: "+",
  BTN_COPY: "\u29C9", // ⧉
  BTN_MOVE: "\u21F5", // ⇵
  BTN_REMOVE: "\u2715", // ✕
  TITLE_ADD: "Add field [a]",
  TITLE_COPY: "Copy [c]",
  TITLE_MOVE: "Move [m]",
  TITLE_REMOVE: "Remove [d]",

  // ARIA
  ROLE_TREE: "tree",
  ROLE_TREEITEM: "treeitem",
  ARIA_LABEL_TREE: "Schema tree",

  // CSS classes
  CLS_ROW: "tree-row",
  CLS_CHEVRON: "tree-chevron",
  CLS_LABEL: "tree-label",
  CLS_ACTIONS: "row-actions",
  CLS_ACTION_BTN: "action-btn",
  CLS_FOCUSED: "focused",
  CLS_NAME: "node-name",
  CLS_NAME_RECORD: "record-name",
  CLS_NAME_FIELD: "field-name",
  CLS_BADGE: "type-badge",
  CLS_BADGE_PRIMITIVE: "primitive-badge",
  CLS_BADGE_COMPLEX: "complex-badge",
  CLS_BADGE_UNION: "union-badge",
  CLS_DETAIL_TITLE: "detail-title",
  CLS_DETAIL_ROW: "detail-row",
  CLS_DETAIL_KEY: "detail-key",
  CLS_DETAIL_VALUE: "detail-value",
  CLS_DETAIL_HEADING: "detail-section-heading",
  CLS_DETAIL_INPUT: "detail-input",
  CLS_DETAIL_TEXTAREA: "detail-textarea",
  CLS_DETAIL_SELECT: "detail-select",
  CLS_DETAIL_LIST: "detail-list",
  CLS_DETAIL_LIST_ITEM: "detail-list-item",
  CLS_DETAIL_ADD_BTN: "detail-add-btn",
  CLS_DETAIL_REMOVE_BTN: "detail-remove-btn",
  CLS_DETAIL_BADGE: "detail-type-badge",

  // Search
  CLS_SEARCH_MATCH: "search-match",
  CLS_SEARCH_FOCUS: "search-focus",
  SEARCH_DEBOUNCE_MS: 150,
  SEARCH_PREFIX_NAME: "n:",
  SEARCH_PREFIX_TYPE: "t:",
  SEARCH_PREFIX_PARENT: "p:",
  SEARCH_PREFIX_NAMESPACE: "ns:",
  SEARCH_PREFIX_GLOBAL: "g:",
  SEARCH_HISTORY_KEY: "avroSearchHistory",
  SEARCH_HISTORY_MAX: 50,

  // IDs
  ID_TREE: "schemaTree",
  ID_DISPLAY: "schemaDisplay",
  ID_DETAIL_PANEL: "sidePanelDetails",
  ID_SEARCH_INPUT: "sideSearchInput",
  ID_SEARCH_COUNTER: "searchMatchCounter",
  ID_SEARCH_HISTORY: "searchHistory",

  // History dropdown CSS
  CLS_HISTORY_ITEM: "search-history-item",
  CLS_HISTORY_HIGHLIGHTED: "highlighted",
});

const DETAIL_TOOLTIPS = Object.freeze({
  name: "Unique field identifier within its record",
  type: "Avro data type for this field",
  "inner type":
    "Element type contained within this complex type (array items, map values, union branches)",
  namespace: "Dot-separated namespace (inherited from parent record)",
  doc: "Human-readable documentation string",
  default: "Default value when field is missing from input",
  order: "Sort order for record comparison (ascending/descending/ignore)",
  aliases: "Alternative names for schema evolution compatibility",
  symbols: "Allowed values for this enum type",
  size: "Fixed byte size for this type",
  logicalType: "Semantic type layered on a primitive (e.g. date, decimal)",
  precision: "Total number of digits for decimal type",
  scale: "Digits to the right of decimal point",
  items: "Element type for array entries",
  values: "Value type for map entries",
});

// ─── State ───────────────────────────────────────────────────────────────────

let expandedNodeIds = new Set();
let flatVisibleNodes = []; // ordered array of {id, depth}
let focusedIndex = -1; // index into flatVisibleNodes (-1 = nothing focused)

// Search state
let searchResults = []; // array of nodeIds that matched (ordered by score)
let searchFocusIdx = -1; // index into searchResults (-1 = no match focused)
let searchActive = false; // true when search has active results
let searchDebounceTimer = null;
let historyHighlightIdx = -1; // index in history dropdown (-1 = none highlighted)

// ─── Core: Flatten Visible Nodes ─────────────────────────────────────────────

/**
 * Compute the ordered list of visible node IDs based on expand/collapse state.
 * A node is visible if all its ancestors are expanded.
 * Skips the "schema" wrapper node — starts from the root type.
 *
 * Design: Fields with primitive types don't show the type as a separate row.
 * Fields with complex types show the type as an expandable child.
 */
function flattenVisibleNodes(projection, expanded) {
  const result = [];
  const schema = projection.nodes.get(projection.rootId);
  if (!schema || schema.children.length === 0) return result;

  const rootType = projection.nodes.get(schema.children[0]);
  if (!rootType) return result;

  function visit(nodeId, depth) {
    const node = projection.nodes.get(nodeId);
    if (!node) return;
    result.push({ id: nodeId, depth });

    if (!isNodeExpandable(node, projection)) return;
    if (!expanded.has(nodeId)) return;

    const expandableChildren = getExpandableChildren(node, projection);
    for (const childId of expandableChildren) {
      visit(childId, depth + 1);
    }
  }

  visit(rootType.id, 0);
  return result;
}

/**
 * Determine if a node is expandable (shows a chevron).
 * - Records with children are expandable
 * - Fields whose type is a complex/union type are expandable
 * - Unions with branches are expandable
 * - Arrays/Maps with children are expandable
 */
function isNodeExpandable(node, projection) {
  switch (node.kind) {
    case "record":
      return node.children.length > 0;

    case "field": {
      const typeChild = projection.nodes.get(node.children[0]);
      if (!typeChild) return false;
      return (
        typeChild.kind === "record" ||
        typeChild.kind === "union" ||
        typeChild.kind === "array" ||
        typeChild.kind === "map" ||
        typeChild.kind === "enum"
      );
    }

    case "union":
      return node.children.length > 0;

    case "array":
    case "map":
      return node.children.length > 0;

    default:
      return false;
  }
}

/**
 * Get the child IDs to visit when a node is expanded.
 * - Record → its field children
 * - Field → its type child's children (skips the type node — shown in badge)
 * - Union → its branch children
 * - Array → its items child
 * - Map → its values child
 */
function getExpandableChildren(node, projection) {
  switch (node.kind) {
    case "record":
      return node.children;

    case "field": {
      // Skip the intermediate type node — its info is in the field's badge.
      // Show the type's children directly.
      const typeChild = projection.nodes.get(node.children[0]);
      if (!typeChild) return [];
      if (typeChild.kind === "record" || typeChild.kind === "union") {
        return typeChild.children;
      }
      // array/map: show the items/values child as a row (it may be complex)
      return typeChild.children;
    }

    case "union":
      return node.children;

    case "array":
    case "map":
      return node.children;

    default:
      return [];
  }
}

// ─── DOM Helpers ─────────────────────────────────────────────────────────────

function el(tag, className, textContent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent !== undefined) node.textContent = textContent;
  return node;
}

function span(className, text) {
  return el("span", className, text);
}

// ─── Entry Points ────────────────────────────────────────────────────────────

function renderSchemaTree() {
  if (!currentProjection) return;
  renderProjection(currentProjection);
}

function renderProjection(projection) {
  const container = document.getElementById(RENDER.ID_TREE);
  if (!container) return;

  container.innerHTML = "";
  document.getElementById(RENDER.ID_DISPLAY).classList.remove("hidden");

  const schema = projection.nodes.get(projection.rootId);
  if (!schema || schema.children.length === 0) {
    container.textContent = "No schema loaded";
    return;
  }

  const rootType = projection.nodes.get(schema.children[0]);
  if (!rootType) {
    container.textContent = "Invalid schema";
    return;
  }

  // Auto-expand root on first render
  if (expandedNodeIds.size === 0) {
    expandedNodeIds.add(rootType.id);
  }

  // Rebuild flat list
  flatVisibleNodes = flattenVisibleNodes(projection, expandedNodeIds);

  // Set ARIA role on container and make focusable
  container.setAttribute("role", RENDER.ROLE_TREE);
  container.setAttribute("aria-label", RENDER.ARIA_LABEL_TREE);
  container.setAttribute("tabindex", "-1");

  // Render each visible row
  for (let i = 0; i < flatVisibleNodes.length; i++) {
    const { id, depth } = flatVisibleNodes[i];
    const node = projection.nodes.get(id);
    if (!node) continue;
    container.appendChild(renderRow(node, projection, depth, i));

    // Enum symbols: show as sub-rows when field with enum type is expanded
    if (node.kind === "field" && expandedNodeIds.has(id)) {
      const typeChild = projection.nodes.get(node.children[0]);
      if (
        typeChild &&
        typeChild.kind === "enum" &&
        typeChild.attributes.native.symbols
      ) {
        for (const sym of typeChild.attributes.native.symbols) {
          const symRow = el("div", RENDER.CLS_ROW + " enum-symbol-row");
          symRow.style.paddingLeft =
            (depth + 1) * RENDER.INDENT_PX + RENDER.ROW_PAD_PX + "px";
          symRow.appendChild(
            span(RENDER.CLS_BADGE + " " + RENDER.CLS_BADGE_PRIMITIVE, sym),
          );
          container.appendChild(symRow);
        }
      }
    }
  }

  // Restore focus highlight
  applyFocusHighlight(container);

  // Re-apply search highlights if search is active
  if (searchActive) applySearchHighlights();
}

// ─── Row Rendering ───────────────────────────────────────────────────────────

function renderRow(node, projection, depth, index) {
  const row = el("div", RENDER.CLS_ROW);
  row.dataset.nodeId = node.id;
  row.dataset.index = index;
  row.style.paddingLeft = depth * RENDER.INDENT_PX + RENDER.ROW_PAD_PX + "px";
  row.setAttribute("role", RENDER.ROLE_TREEITEM);
  row.setAttribute("aria-level", depth + 1);
  row.setAttribute("tabindex", "-1");

  const expandable = isNodeExpandable(node, projection);
  const expanded = expandedNodeIds.has(node.id);

  if (expandable) {
    row.setAttribute("aria-expanded", String(expanded));
  }

  // Chevron
  const chevron = buildChevron(expandable, expanded, node.id);
  row.appendChild(chevron);

  // Label (name + type badge)
  const label = el("span", RENDER.CLS_LABEL);
  label.appendChild(renderNodeLabel(node, projection));
  row.appendChild(label);

  // Action buttons (for actionable node kinds)
  if (node.kind === "field" || node.kind === "record") {
    row.appendChild(buildRowActions(node.id));
  }

  return row;
}

function buildChevron(expandable, expanded, nodeId) {
  const chevron = span(RENDER.CLS_CHEVRON);
  if (expandable) {
    chevron.textContent = expanded
      ? RENDER.CHEVRON_EXPANDED
      : RENDER.CHEVRON_COLLAPSED;
    chevron.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleExpand(nodeId);
    });
  } else {
    chevron.textContent = RENDER.CHEVRON_NONE;
    chevron.style.visibility = "hidden";
  }
  return chevron;
}

/**
 * Build the label content for a tree row.
 */
function renderNodeLabel(node, projection) {
  const frag = document.createDocumentFragment();

  switch (node.kind) {
    case "record":
      frag.appendChild(
        span(
          RENDER.CLS_NAME + " " + RENDER.CLS_NAME_RECORD,
          node.attributes.native.name || RENDER.LABEL_RECORD_DEFAULT,
        ),
      );
      frag.appendChild(
        span(
          RENDER.CLS_BADGE + " " + RENDER.CLS_BADGE_COMPLEX,
          RENDER.LABEL_RECORD,
        ),
      );
      break;

    case "field": {
      frag.appendChild(
        span(
          RENDER.CLS_NAME + " " + RENDER.CLS_NAME_FIELD,
          node.attributes.native.name || RENDER.LABEL_FIELD_DEFAULT,
        ),
      );
      const typeChild = projection.nodes.get(node.children[0]);
      if (typeChild) {
        frag.appendChild(
          span(
            RENDER.CLS_BADGE + " " + badgeClassForNode(typeChild),
            typeBadgeText(typeChild, projection),
          ),
        );
      }
      break;
    }

    case "union":
      frag.appendChild(
        span(
          RENDER.CLS_BADGE + " " + RENDER.CLS_BADGE_UNION,
          unionBadgeText(node, projection),
        ),
      );
      break;

    case "array": {
      const itemsChild = projection.nodes.get(node.children[0]);
      const text = itemsChild
        ? RENDER.LABEL_ARRAY + "<" + typeBadgeText(itemsChild, projection) + ">"
        : RENDER.LABEL_ARRAY;
      frag.appendChild(
        span(RENDER.CLS_BADGE + " " + RENDER.CLS_BADGE_COMPLEX, text),
      );
      break;
    }

    case "map": {
      const valuesChild = projection.nodes.get(node.children[0]);
      const text = valuesChild
        ? RENDER.LABEL_MAP + "<" + typeBadgeText(valuesChild, projection) + ">"
        : RENDER.LABEL_MAP;
      frag.appendChild(
        span(RENDER.CLS_BADGE + " " + RENDER.CLS_BADGE_COMPLEX, text),
      );
      break;
    }

    case "enum":
      frag.appendChild(
        span(
          RENDER.CLS_NAME,
          node.attributes.native.name || RENDER.LABEL_ENUM_DEFAULT,
        ),
      );
      frag.appendChild(
        span(
          RENDER.CLS_BADGE + " " + RENDER.CLS_BADGE_COMPLEX,
          RENDER.LABEL_ENUM,
        ),
      );
      break;

    case "fixed": {
      frag.appendChild(
        span(
          RENDER.CLS_NAME,
          node.attributes.native.name || RENDER.LABEL_FIXED_DEFAULT,
        ),
      );
      const size = node.attributes.native.size || RENDER.LABEL_UNKNOWN;
      frag.appendChild(
        span(
          RENDER.CLS_BADGE + " " + RENDER.CLS_BADGE_COMPLEX,
          RENDER.LABEL_FIXED + "(" + size + ")",
        ),
      );
      break;
    }

    default:
      // primitive / named
      frag.appendChild(
        span(
          RENDER.CLS_BADGE + " " + RENDER.CLS_BADGE_PRIMITIVE,
          typeBadgeText(node, projection),
        ),
      );
      break;
  }

  return frag;
}

// ─── Type Badge Helpers ──────────────────────────────────────────────────────

function typeBadgeText(typeNode, projection) {
  if (!typeNode) return RENDER.LABEL_UNKNOWN;
  const native = typeNode.attributes.native;

  switch (typeNode.kind) {
    case "primitive":
    case "named":
      if (typeof native === "string") return native;
      if (native.logicalType)
        return native.type + "(" + native.logicalType + ")";
      return native.type || typeNode.kind;

    case "record":
      return native.name || RENDER.LABEL_RECORD;

    case "enum":
      return RENDER.LABEL_ENUM;

    case "fixed":
      return (
        RENDER.LABEL_FIXED + "(" + (native.size || RENDER.LABEL_UNKNOWN) + ")"
      );

    case "union":
      return unionBadgeText(typeNode, projection);

    case "array": {
      const items = projection.nodes.get(typeNode.children[0]);
      return items
        ? RENDER.LABEL_ARRAY + "<" + typeBadgeText(items, projection) + ">"
        : RENDER.LABEL_ARRAY;
    }

    case "map": {
      const values = projection.nodes.get(typeNode.children[0]);
      return values
        ? RENDER.LABEL_MAP + "<" + typeBadgeText(values, projection) + ">"
        : RENDER.LABEL_MAP;
    }

    default:
      return typeNode.kind;
  }
}

function unionBadgeText(unionNode, projection) {
  if (!unionNode || unionNode.children.length === 0) return RENDER.LABEL_UNION;
  const parts = unionNode.children.map((childId) => {
    const child = projection.nodes.get(childId);
    if (!child) return RENDER.LABEL_UNKNOWN;
    const native = child.attributes.native;
    if (typeof native === "string") return native;
    if (native.name) return native.name;
    if (native.type) return native.type;
    return child.kind;
  });
  if (parts.length <= RENDER.UNION_INLINE_MAX) {
    return "[" + parts.join(", ") + "]";
  }
  return "[" + parts.slice(0, 2).join(", ") + ", +" + (parts.length - 2) + "]";
}

function badgeClassForNode(typeNode) {
  if (!typeNode) return RENDER.CLS_BADGE_PRIMITIVE;
  switch (typeNode.kind) {
    case "primitive":
    case "named":
      return RENDER.CLS_BADGE_PRIMITIVE;
    case "union":
      return RENDER.CLS_BADGE_UNION;
    default:
      return RENDER.CLS_BADGE_COMPLEX;
  }
}

// ─── Row Actions ─────────────────────────────────────────────────────────────

function buildRowActions(nodeId) {
  const node = currentProjection.nodes.get(nodeId);
  const actions = span(RENDER.CLS_ACTIONS);
  const kind = node ? node.kind : "";
  const canAdd = kind === "record" || kind === "field";
  if (canAdd) {
    actions.appendChild(
      buildActionBtn(RENDER.BTN_ADD, RENDER.TITLE_ADD, () => actionAdd(nodeId)),
    );
    actions.appendChild(
      buildActionBtn(RENDER.BTN_COPY, RENDER.TITLE_COPY, () =>
        actionCopy(nodeId),
      ),
    );
  }
  if (kind === "field") {
    actions.appendChild(
      buildActionBtn(RENDER.BTN_MOVE, RENDER.TITLE_MOVE, () => {
        focusNodeById(nodeId);
        actionMoveMode();
      }),
    );
  }
  actions.appendChild(
    buildActionBtn(RENDER.BTN_REMOVE, RENDER.TITLE_REMOVE, () =>
      actionRemove(nodeId),
    ),
  );
  return actions;
}

function buildActionBtn(text, title, handler) {
  const btn = el("button", RENDER.CLS_ACTION_BTN, text);
  btn.title = title;
  btn.setAttribute("tabindex", "-1");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    handler();
  });
  return btn;
}

// ─── Action Handlers ─────────────────────────────────────────────────────────

function actionRemove(nodeId) {
  const node = currentProjection.nodes.get(nodeId);
  if (!node) return;

  if (isInSingleSlot(node, currentProjection)) {
    warningToast("Cannot remove a field's type. Replace it instead.");
    return;
  }

  // Adjust focus before removing
  const idx = flatVisibleNodes.findIndex((n) => n.id === nodeId);
  if (idx === focusedIndex) {
    focusedIndex = Math.min(idx, flatVisibleNodes.length - 2);
  }

  executeCommand(
    removeNodeCommand({ nodeId }, currentProjection, refreshAfterMutation),
  );
}

function actionCopy(nodeId) {
  const node = currentProjection.nodes.get(nodeId);
  if (!node) return;

  const parentRecord = findAncestorRecord(node, currentProjection);
  if (!parentRecord) {
    warningToast("Cannot copy: no parent record found");
    return;
  }

  executeCommand(
    copyNodeCommand(
      {
        sourceNodeId: nodeId,
        targetNodeId: parentRecord.id,
        slot: SLOT.RECORD_FIELDS,
      },
      currentProjection,
      refreshAfterMutation,
    ),
  );
}

function actionAdd(nodeId) {
  const node = currentProjection.nodes.get(nodeId);
  if (!node) return;

  let targetRecord;
  let insertIndex;

  if (node.kind === "record") {
    targetRecord = node;
    // Add at end of record
  } else {
    targetRecord = findAncestorRecord(node, currentProjection);
    // Insert after the current field
    if (targetRecord && node.kind === "field") {
      const siblingIdx = targetRecord.children.indexOf(nodeId);
      if (siblingIdx >= 0) insertIndex = siblingIdx + 1;
    }
  }

  if (!targetRecord) {
    warningToast("Cannot add: no target record found");
    return;
  }

  // Ensure target is expanded so new field is visible
  expandedNodeIds.add(targetRecord.id);

  const newField = buildFieldSubtree({ name: "newField", type: "string" });

  executeCommand(
    createNodeCommand(
      {
        newSubtree: newField,
        targetNodeId: targetRecord.id,
        slot: SLOT.RECORD_FIELDS,
        index: insertIndex,
      },
      currentProjection,
      refreshAfterMutation,
    ),
  );

  // Focus the newly added field after re-render
  const newIdx = flatVisibleNodes.findIndex((n) => n.id === newField.root.id);
  if (newIdx >= 0) focusedIndex = newIdx;
}

/** r — Focus the type-change select in the detail panel */
function actionReplace() {
  const panel = document.getElementById(RENDER.ID_DETAIL_PANEL);
  if (!panel) return;
  const select = panel.querySelector("." + RENDER.CLS_DETAIL_SELECT);
  if (select) select.focus();
}

/** F2 — Focus the first text input (name) in the detail panel */
function actionRename() {
  const panel = document.getElementById(RENDER.ID_DETAIL_PANEL);
  if (!panel) return;
  const input = panel.querySelector("input." + RENDER.CLS_DETAIL_INPUT);
  if (input) {
    input.focus();
    input.select();
  }
}

// ─── Move Mode ───────────────────────────────────────────────────────────────

let moveMode = false;
let moveModeNodeId = null;
let moveModeTargets = [];
let moveModeIndex = 0;

function actionMoveMode() {
  const nodeId = getFocusedNodeId();
  if (!nodeId) return;
  const node = currentProjection.nodes.get(nodeId);
  if (!node || node.kind !== "field") {
    warningToast("Move only works on fields");
    return;
  }
  const targets = getValidMoveTargets(nodeId, currentProjection);
  if (targets.length === 0) {
    warningToast("No valid move targets");
    return;
  }
  moveMode = true;
  moveModeNodeId = nodeId;
  moveModeTargets = targets;
  moveModeIndex = 0;
  renderMoveOverlay();
}

function cancelMoveMode() {
  moveMode = false;
  moveModeNodeId = null;
  moveModeTargets = [];
  removeMoveOverlay();
}

function confirmMove() {
  if (!moveMode || moveModeTargets.length === 0) return;
  const target = moveModeTargets[moveModeIndex];
  const cmd = moveNodeCommand(
    {
      nodeId: moveModeNodeId,
      targetNodeId: target.targetNodeId,
      slot: target.slot,
      index: target.index,
    },
    currentProjection,
    refreshAfterMutation,
  );
  executeCommand(cmd);
  cancelMoveMode();
}

function renderMoveOverlay() {
  removeMoveOverlay();
  const tree = document.getElementById(RENDER.ID_TREE);
  if (!tree) return;

  const overlay = el("div", "move-overlay");
  overlay.id = "moveOverlay";

  const header = el("div", "move-overlay-header");
  header.textContent = "Move to (↑↓ select, Enter confirm, Esc cancel)";
  overlay.appendChild(header);

  const list = el("div", "move-overlay-list");
  for (let i = 0; i < moveModeTargets.length; i++) {
    const t = moveModeTargets[i];
    const targetNode = currentProjection.nodes.get(t.targetNodeId);
    const name = targetNode?.attributes?.native?.name || t.targetNodeId;
    const label =
      name + (t.index != null ? " [pos " + (t.index + 1) + "]" : "");

    const item = el(
      "div",
      "move-overlay-item" + (i === moveModeIndex ? " move-active" : ""),
    );
    item.textContent = label;
    item.dataset.idx = i;
    item.addEventListener("click", () => {
      moveModeIndex = i;
      renderMoveOverlay();
      confirmMove();
    });
    list.appendChild(item);
  }
  overlay.appendChild(list);
  tree.parentElement.appendChild(overlay);
}

function removeMoveOverlay() {
  const existing = document.getElementById("moveOverlay");
  if (existing) existing.remove();
}

// Override keyboard in move mode
function handleMoveModeKey(e) {
  if (!moveMode) return false;
  switch (e.key) {
    case "ArrowDown":
    case "j":
      e.preventDefault();
      moveModeIndex = Math.min(moveModeIndex + 1, moveModeTargets.length - 1);
      renderMoveOverlay();
      return true;
    case "ArrowUp":
    case "k":
      e.preventDefault();
      moveModeIndex = Math.max(moveModeIndex - 1, 0);
      renderMoveOverlay();
      return true;
    case "Enter":
      e.preventDefault();
      confirmMove();
      return true;
    case "Escape":
      e.preventDefault();
      cancelMoveMode();
      return true;
  }
  return false;
}

// ─── Focus Management ────────────────────────────────────────────────────────

function getFocusedNodeId() {
  if (focusedIndex < 0 || focusedIndex >= flatVisibleNodes.length) return null;
  return flatVisibleNodes[focusedIndex].id;
}

function focusNodeById(nodeId) {
  const idx = flatVisibleNodes.findIndex((n) => n.id === nodeId);
  if (idx >= 0) {
    focusedIndex = idx;
    applyFocusHighlight();
    scrollFocusedIntoView();
    const node = currentProjection.nodes.get(nodeId);
    if (node) renderNodeDetails(node);
  }
}

function moveFocus(delta) {
  if (flatVisibleNodes.length === 0) return;
  const newIdx = Math.max(
    0,
    Math.min(flatVisibleNodes.length - 1, focusedIndex + delta),
  );
  if (newIdx === focusedIndex) return;
  focusedIndex = newIdx;
  applyFocusHighlight();
  scrollFocusedIntoView();
  const nodeId = flatVisibleNodes[focusedIndex].id;
  const node = currentProjection.nodes.get(nodeId);
  if (node) renderNodeDetails(node);
}

function focusFirst() {
  if (flatVisibleNodes.length === 0) return;
  focusedIndex = 0;
  applyFocusHighlight();
  scrollFocusedIntoView();
}

function focusLast() {
  if (flatVisibleNodes.length === 0) return;
  focusedIndex = flatVisibleNodes.length - 1;
  applyFocusHighlight();
  scrollFocusedIntoView();
}

function applyFocusHighlight(container) {
  const tree = container || document.getElementById(RENDER.ID_TREE);
  if (!tree) return;

  const previouslyFocused = tree.querySelectorAll("." + RENDER.CLS_FOCUSED);
  for (let i = 0; i < previouslyFocused.length; i++) {
    previouslyFocused[i].classList.remove(RENDER.CLS_FOCUSED);
    previouslyFocused[i].removeAttribute("aria-selected");
  }

  if (focusedIndex < 0 || focusedIndex >= flatVisibleNodes.length) return;

  const nodeId = flatVisibleNodes[focusedIndex].id;
  const target = tree.querySelector('[data-node-id="' + nodeId + '"]');
  if (target) {
    target.classList.add(RENDER.CLS_FOCUSED);
    target.setAttribute("aria-selected", "true");
  }
}

function scrollFocusedIntoView() {
  if (focusedIndex < 0 || focusedIndex >= flatVisibleNodes.length) return;
  const nodeId = flatVisibleNodes[focusedIndex].id;
  const target = document.querySelector('[data-node-id="' + nodeId + '"]');
  if (target) target.scrollIntoView({ block: "center", behavior: "smooth" });
}

// ─── Expand / Collapse ───────────────────────────────────────────────────────

function toggleExpand(nodeId) {
  if (expandedNodeIds.has(nodeId)) {
    expandedNodeIds.delete(nodeId);
  } else {
    expandedNodeIds.add(nodeId);
  }
  const focusedId = getFocusedNodeId();
  renderProjection(currentProjection);
  if (focusedId) focusNodeById(focusedId);
}

function expandFocused() {
  const nodeId = getFocusedNodeId();
  if (!nodeId) return;
  const node = currentProjection.nodes.get(nodeId);
  if (!node) return;

  if (isNodeExpandable(node, currentProjection)) {
    if (!expandedNodeIds.has(nodeId)) {
      expandedNodeIds.add(nodeId);
      renderProjection(currentProjection);
      focusNodeById(nodeId);
    } else {
      // Already expanded: move to first child
      moveFocus(1);
    }
  }
}

function collapseFocused() {
  const nodeId = getFocusedNodeId();
  if (!nodeId) return;
  const node = currentProjection.nodes.get(nodeId);
  if (!node) return;

  if (
    isNodeExpandable(node, currentProjection) &&
    expandedNodeIds.has(nodeId)
  ) {
    expandedNodeIds.delete(nodeId);
    renderProjection(currentProjection);
    focusNodeById(nodeId);
  } else if (node.parentId) {
    // Move to parent
    const parentIdx = flatVisibleNodes.findIndex((n) => n.id === node.parentId);
    if (parentIdx >= 0) {
      focusedIndex = parentIdx;
      applyFocusHighlight();
      scrollFocusedIntoView();
    }
  }
}

/**
 * Expand all ancestors of a node so it becomes visible in the flat list.
 * Walks up the tree and expands each ancestor that is expandable.
 */
function ensureNodeVisible(nodeId, projection) {
  const node = projection.nodes.get(nodeId);
  if (!node) return;

  // Collect ancestors from node up to root
  const ancestors = [];
  let current = node;
  while (current.parentId) {
    const parent = projection.nodes.get(current.parentId);
    if (!parent) break;
    ancestors.push(parent.id);
    current = parent;
  }

  // Expand ancestors top-down (skip schema wrapper — it's never in the flat list)
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const ancestorId = ancestors[i];
    const ancestor = projection.nodes.get(ancestorId);
    if (ancestor && isNodeExpandable(ancestor, projection)) {
      expandedNodeIds.add(ancestorId);
    }
    // For fields: we expand the field, which reveals its type's children.
    // The node might be a child of the type, but the type is skipped in rendering.
    // The field is what needs expanding for its sub-nodes to appear.
    if (ancestor && ancestor.kind === "field") {
      expandedNodeIds.add(ancestorId);
    }
  }
}

// ─── Search UI ───────────────────────────────────────────────────────────────

/**
 * Parse search input text into queryNodes-compatible filters object.
 * Supports prefixes: n: (name), t: (type), p: (parent), ns: (namespace)
 * Unprefixed text → free-text search (matches all properties).
 */
function parseSearchInput(text) {
  if (!text || !text.trim()) return null;

  const trimmed = text.trim();
  const filters = {};

  if (trimmed.startsWith(RENDER.SEARCH_PREFIX_NAMESPACE)) {
    filters.namespace = trimmed
      .slice(RENDER.SEARCH_PREFIX_NAMESPACE.length)
      .trim();
  } else if (trimmed.startsWith(RENDER.SEARCH_PREFIX_GLOBAL)) {
    filters.text = trimmed.slice(RENDER.SEARCH_PREFIX_GLOBAL.length).trim();
  } else if (trimmed.startsWith(RENDER.SEARCH_PREFIX_NAME)) {
    filters.name = trimmed.slice(RENDER.SEARCH_PREFIX_NAME.length).trim();
  } else if (trimmed.startsWith(RENDER.SEARCH_PREFIX_TYPE)) {
    filters.type = trimmed.slice(RENDER.SEARCH_PREFIX_TYPE.length).trim();
  } else if (trimmed.startsWith(RENDER.SEARCH_PREFIX_PARENT)) {
    filters.parent = trimmed.slice(RENDER.SEARCH_PREFIX_PARENT.length).trim();
  } else {
    // Default: search by name
    filters.name = trimmed;
  }

  // Return null if the filter value is empty after prefix
  const values = Object.values(filters);
  if (values.length === 0 || values.every((v) => !v)) return null;

  return filters;
}

/**
 * Execute a search: query nodes, auto-expand ancestors, re-render, highlight.
 */
function executeSearch(text) {
  if (!currentProjection) return;

  const filters = parseSearchInput(text);

  if (!filters) {
    // No valid filter yet (empty input or incomplete prefix like "t:")
    // Reset search results without clearing input — user may still be typing
    searchResults = [];
    searchFocusIdx = -1;
    searchActive = false;
    if (currentProjection) renderProjection(currentProjection);
    updateSearchCounter();
    return;
  }

  const results = queryNodes(currentProjection, filters);

  if (results.length === 0) {
    searchResults = [];
    searchFocusIdx = -1;
    searchActive = true;
    renderProjection(currentProjection);
    updateSearchCounter();
    return;
  }

  // Store matched nodeIds, sorted by on-screen tree order
  searchResults = results.map((r) => r.nodeId);

  // Auto-expand ancestors so matches become visible
  for (const nodeId of searchResults) {
    ensureNodeVisible(nodeId, currentProjection);
  }

  // Re-render tree with new expand state (rebuilds flatVisibleNodes)
  renderProjection(currentProjection);

  // Sort results by their position in the visible tree
  const positionMap = new Map();
  for (let i = 0; i < flatVisibleNodes.length; i++) {
    positionMap.set(flatVisibleNodes[i].id, i);
  }
  searchResults.sort(
    (a, b) => (positionMap.get(a) || 0) - (positionMap.get(b) || 0),
  );

  searchFocusIdx = 0;
  searchActive = true;

  // Focus first match in tree
  focusSearchMatch(0);
  updateSearchCounter();
  saveSearchHistory(text);
}

/**
 * Clear all search state and highlights. Does NOT clear input text.
 */
function clearSearch() {
  searchResults = [];
  searchFocusIdx = -1;
  searchActive = false;

  if (currentProjection) renderProjection(currentProjection);
  updateSearchCounter();
}

/**
 * Move to the next search match.
 */
function nextSearchMatch() {
  if (searchResults.length === 0) return;
  searchFocusIdx = (searchFocusIdx + 1) % searchResults.length;
  focusSearchMatch(searchFocusIdx);
  updateSearchCounter();
}

/**
 * Move to the previous search match.
 */
function prevSearchMatch() {
  if (searchResults.length === 0) return;
  searchFocusIdx =
    (searchFocusIdx - 1 + searchResults.length) % searchResults.length;
  focusSearchMatch(searchFocusIdx);
  updateSearchCounter();
}

/**
 * Focus a specific search match by index: set focusedIndex, scroll, show details.
 */
function focusSearchMatch(matchIdx) {
  if (matchIdx < 0 || matchIdx >= searchResults.length) return;

  const nodeId = searchResults[matchIdx];
  const flatIdx = flatVisibleNodes.findIndex((n) => n.id === nodeId);

  if (flatIdx >= 0) {
    focusedIndex = flatIdx;
    applyFocusHighlight();
    applySearchHighlights();
    scrollFocusedIntoView();
    const node = currentProjection.nodes.get(nodeId);
    if (node) renderNodeDetails(node);
  }
}

/**
 * Apply search highlight CSS classes to matching rows.
 * Called after renderProjection (which rebuilds DOM).
 */
function applySearchHighlights() {
  const tree = document.getElementById(RENDER.ID_TREE);
  if (!tree || !searchActive) return;

  // Remove previous search highlights
  const prevMatches = tree.querySelectorAll("." + RENDER.CLS_SEARCH_MATCH);
  for (let i = 0; i < prevMatches.length; i++) {
    prevMatches[i].classList.remove(RENDER.CLS_SEARCH_MATCH);
  }
  const prevFocus = tree.querySelectorAll("." + RENDER.CLS_SEARCH_FOCUS);
  for (let i = 0; i < prevFocus.length; i++) {
    prevFocus[i].classList.remove(RENDER.CLS_SEARCH_FOCUS);
  }

  // Apply .search-match to all results
  const matchSet = new Set(searchResults);
  for (const nodeId of matchSet) {
    const row = tree.querySelector('[data-node-id="' + nodeId + '"]');
    if (row) row.classList.add(RENDER.CLS_SEARCH_MATCH);
  }

  // Apply .search-focus to the current focused match
  if (searchFocusIdx >= 0 && searchFocusIdx < searchResults.length) {
    const focusNodeId = searchResults[searchFocusIdx];
    const focusRow = tree.querySelector('[data-node-id="' + focusNodeId + '"]');
    if (focusRow) focusRow.classList.add(RENDER.CLS_SEARCH_FOCUS);
  }
}

/**
 * Update the match counter display [current/total].
 */
function updateSearchCounter() {
  const counter = document.getElementById(RENDER.ID_SEARCH_COUNTER);
  if (!counter) return;

  if (!searchActive || searchResults.length === 0) {
    counter.classList.add("hidden");
    counter.textContent = "[0/0]";
    return;
  }

  counter.classList.remove("hidden");
  counter.textContent =
    "[" + (searchFocusIdx + 1) + "/" + searchResults.length + "]";
}

/**
 * Save a search term to localStorage history.
 */
function saveSearchHistory(text) {
  if (!text || !text.trim()) return;
  try {
    const stored = localStorage.getItem(RENDER.SEARCH_HISTORY_KEY);
    let history = stored ? JSON.parse(stored) : [];
    // Remove duplicate if exists
    history = history.filter((h) => h !== text);
    // Add to front
    history.unshift(text);
    // Cap at max
    if (history.length > RENDER.SEARCH_HISTORY_MAX) {
      history = history.slice(0, RENDER.SEARCH_HISTORY_MAX);
    }
    localStorage.setItem(RENDER.SEARCH_HISTORY_KEY, JSON.stringify(history));
  } catch (e) {
    // localStorage not available — silently ignore
  }
}

/**
 * Load search history from localStorage.
 */
function loadSearchHistory() {
  try {
    const stored = localStorage.getItem(RENDER.SEARCH_HISTORY_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    return [];
  }
}

/**
 * Show the search history dropdown (if any history exists).
 */
function showSearchHistory() {
  const dropdown = document.getElementById(RENDER.ID_SEARCH_HISTORY);
  if (!dropdown) return;

  const history = loadSearchHistory();
  if (history.length === 0) {
    hideSearchHistory();
    return;
  }

  dropdown.textContent = "";
  historyHighlightIdx = -1;

  for (let i = 0; i < history.length; i++) {
    const item = el("div", RENDER.CLS_HISTORY_ITEM, history[i]);
    item.dataset.index = i;
    item.addEventListener("mousedown", (e) => {
      // mousedown (not click) fires before blur hides dropdown
      e.preventDefault();
      selectHistoryItem(history[i]);
    });
    dropdown.appendChild(item);
  }

  dropdown.classList.remove("hidden");
}

/**
 * Hide the search history dropdown.
 */
function hideSearchHistory() {
  const dropdown = document.getElementById(RENDER.ID_SEARCH_HISTORY);
  if (dropdown) {
    dropdown.classList.add("hidden");
    dropdown.textContent = "";
  }
  historyHighlightIdx = -1;
}

/**
 * Select a history item: fill input, execute search, hide dropdown.
 */
function selectHistoryItem(text) {
  const input = document.getElementById(RENDER.ID_SEARCH_INPUT);
  if (input) {
    input.value = text;
    input.focus();
  }
  hideSearchHistory();
  executeSearch(text);
}

/**
 * Navigate the history dropdown with arrow keys.
 */
function navigateHistory(delta) {
  const dropdown = document.getElementById(RENDER.ID_SEARCH_HISTORY);
  if (!dropdown || dropdown.classList.contains("hidden")) return false;

  const items = dropdown.querySelectorAll("." + RENDER.CLS_HISTORY_ITEM);
  if (items.length === 0) return false;

  // Remove current highlight
  if (historyHighlightIdx >= 0 && historyHighlightIdx < items.length) {
    items[historyHighlightIdx].classList.remove(RENDER.CLS_HISTORY_HIGHLIGHTED);
  }

  historyHighlightIdx = Math.max(
    -1,
    Math.min(items.length - 1, historyHighlightIdx + delta),
  );

  if (historyHighlightIdx >= 0) {
    items[historyHighlightIdx].classList.add(RENDER.CLS_HISTORY_HIGHLIGHTED);
    items[historyHighlightIdx].scrollIntoView({ block: "nearest" });
  }

  return true;
}

/**
 * Handle keydown events in the search input.
 */
function handleSearchKeydown(e) {
  const dropdown = document.getElementById(RENDER.ID_SEARCH_HISTORY);
  const historyVisible = dropdown && !dropdown.classList.contains("hidden");
  const input = document.getElementById(RENDER.ID_SEARCH_INPUT);

  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      if (historyVisible) {
        navigateHistory(1);
      } else if (searchActive) {
        nextSearchMatch();
      }
      break;

    case "ArrowUp":
      e.preventDefault();
      if (historyVisible) {
        navigateHistory(-1);
      } else if (searchActive) {
        prevSearchMatch();
      }
      break;

    case "Enter":
      e.preventDefault();
      e.stopPropagation();
      if (historyVisible && historyHighlightIdx >= 0) {
        // Select highlighted history item
        const items = dropdown.querySelectorAll("." + RENDER.CLS_HISTORY_ITEM);
        if (items[historyHighlightIdx]) {
          selectHistoryItem(items[historyHighlightIdx].textContent);
        }
      } else if (input && input.value.trim()) {
        // Confirm current search and focus the tree
        executeSearch(input.value);
      }
      hideSearchHistory();
      // Move focus to tree so keyboard nav works
      if (input) input.blur();
      document.getElementById(RENDER.ID_TREE)?.focus();
      break;

    case "Escape":
      e.preventDefault();
      if (historyVisible) {
        hideSearchHistory();
      } else {
        // Clear input text, reset search, focus tree
        if (input) input.value = "";
        clearSearch();
        if (input) input.blur();
        document.getElementById(RENDER.ID_TREE)?.focus();
      }
      break;
  }
}

// ─── Detail Panel ────────────────────────────────────────────────────────────

/**
 * Kind-aware detail panel rendering.
 * Shows relevant properties for each node kind with editable inputs.
 * Each edit creates an undoable command via updateAttributeCommand.
 */
function renderNodeDetails(node) {
  const panel = document.getElementById(RENDER.ID_DETAIL_PANEL);
  if (!panel || !node) return;

  // Activate panel slide-in
  const sidePanel = panel.closest(".side-panel");
  if (sidePanel) sidePanel.classList.add("panel-active");

  // Clear panel contents via DOM
  while (panel.firstChild) panel.removeChild(panel.firstChild);
  const native = node.attributes.native;

  // Title: kind badge + name
  const title = el("h3", RENDER.CLS_DETAIL_TITLE);
  const kindBadge = span(RENDER.CLS_DETAIL_BADGE, node.kind);
  title.appendChild(kindBadge);
  if (typeof native === "object" && native.name) {
    title.appendChild(document.createTextNode(" " + native.name));
  } else if (typeof native === "string") {
    title.appendChild(document.createTextNode(" " + native));
  }
  panel.appendChild(title);

  // Dispatch to kind-specific renderer
  switch (node.kind) {
    case "field":
      renderFieldDetails(node, panel);
      break;
    case "record":
      renderRecordDetails(node, panel);
      break;
    case "enum":
      renderEnumDetails(node, panel);
      break;
    case "fixed":
      renderFixedDetails(node, panel);
      break;
    case "primitive":
    case "named":
      renderPrimitiveDetails(node, panel);
      break;
    case "union":
      renderUnionDetails(node, panel);
      break;
    case "array":
      renderArrayDetails(node, panel);
      break;
    case "map":
      renderMapDetails(node, panel);
      break;
    default:
      break;
  }

  // Custom attributes section (all kinds)
  renderCustomAttributes(node, panel);
}

// ─── Kind-Specific Renderers ─────────────────────────────────────────────────

function renderFieldDetails(node, panel) {
  const native = node.attributes.native;

  // Name (editable with validation)
  panel.appendChild(
    buildEditableRow("name", native.name || "", (val, input) => {
      const result = validateName(val);
      if (!applyValidation(input, result)) return;
      commitEdit(node, "native", "name", val, "Rename field to " + val);
    }),
  );

  // Type (replace picker)
  const typeLabel = getNodeTypeLabel(node, currentProjection);
  panel.appendChild(buildReplaceTypeRow("type", typeLabel, node.id));

  // Inline type-specific controls for the field's type child
  const typeChild = currentProjection.nodes.get(node.children[0]);
  if (typeChild) renderTypeChildControls(typeChild, panel);

  // Namespace (inherited from parent record — readonly context)
  const parentNode = currentProjection.nodes.get(node.parentId);
  if (parentNode && parentNode.kind === "record") {
    const parentNs = parentNode.attributes.native.namespace || "";
    panel.appendChild(
      buildReadonlyRow("namespace", parentNs || "(inherited: none)"),
    );
  }

  // Doc (editable textarea — always shown)
  panel.appendChild(
    buildTextareaRow("doc", native.doc || "", (val) => {
      commitEdit(node, "native", "doc", val || undefined, "Update doc");
    }),
  );

  // Default (editable)
  const defaultStr =
    native.default !== undefined
      ? typeof native.default === "object"
        ? JSON.stringify(native.default)
        : String(native.default)
      : "";
  panel.appendChild(
    buildEditableRow("default", defaultStr, (val) => {
      let parsed = val;
      if (val === "") {
        parsed = undefined;
      } else {
        try {
          parsed = JSON.parse(val);
        } catch (_) {
          /* keep as string */
        }
      }
      commitEdit(node, "native", "default", parsed, "Set default");
    }),
  );

  // Order (always shown)
  panel.appendChild(
    buildSelectRow(
      "order",
      ["", "ascending", "descending", "ignore"],
      native.order || "",
      (val) => {
        commitEdit(
          node,
          "native",
          "order",
          val || undefined,
          "Change order to " + (val || "none"),
        );
      },
    ),
  );

  // Aliases (editable list)
  panel.appendChild(
    buildEditableListSection(
      "aliases",
      native.aliases || [],
      node,
      "native",
      "aliases",
    ),
  );
}

/**
 * Renders inline editing controls for a type child node.
 * Called from field/array/map detail panels so the user can edit
 * the type's specific properties without navigating to it directly.
 */
function renderTypeChildControls(typeChild, panel) {
  switch (typeChild.kind) {
    case "union":
      renderUnionDetails(typeChild, panel);
      break;
    case "enum":
      renderEnumDetails(typeChild, panel);
      break;
    case "fixed":
      renderFixedDetails(typeChild, panel);
      break;
    case "array":
      renderArrayDetails(typeChild, panel);
      break;
    case "map":
      renderMapDetails(typeChild, panel);
      break;
    case "primitive":
    case "named":
      renderPrimitiveDetails(typeChild, panel);
      break;
    default:
      break;
  }
}

function renderRecordDetails(node, panel) {
  const native = node.attributes.native;

  // Name + Namespace (side by side)
  panel.appendChild(
    buildNameNamespaceRow(
      native.name || "",
      native.namespace || "",
      (val) =>
        commitEdit(node, "native", "name", val, "Rename record to " + val),
      (val) =>
        commitEdit(
          node,
          "native",
          "namespace",
          val || undefined,
          "Change namespace to " + (val || "none"),
        ),
    ),
  );

  // Doc (editable textarea — always shown)
  panel.appendChild(
    buildTextareaRow("doc", native.doc || "", (val) => {
      commitEdit(node, "native", "doc", val || undefined, "Update doc");
    }),
  );

  // Aliases (editable list)
  panel.appendChild(
    buildEditableListSection(
      "aliases",
      native.aliases || [],
      node,
      "native",
      "aliases",
    ),
  );

  // Fields count (read-only)
  panel.appendChild(buildReadonlyRow("fields", String(node.children.length)));
}

function renderEnumDetails(node, panel) {
  const native = node.attributes.native;

  panel.appendChild(
    buildNameNamespaceRow(
      native.name || "",
      native.namespace || "",
      (val) => commitEdit(node, "native", "name", val, "Rename enum to " + val),
      (val) =>
        commitEdit(
          node,
          "native",
          "namespace",
          val || undefined,
          "Change namespace to " + (val || "none"),
        ),
    ),
  );

  panel.appendChild(
    buildTextareaRow("doc", native.doc || "", (val) => {
      commitEdit(node, "native", "doc", val || undefined, "Update doc");
    }),
  );

  // Symbols (editable list with add/remove + validation)
  panel.appendChild(
    buildEditableListSection(
      "symbols",
      native.symbols || [],
      node,
      "native",
      "symbols",
      validateSymbol,
    ),
  );

  // Default (select from symbols)
  const defaultOptions = ["", ...(native.symbols || [])];
  panel.appendChild(
    buildSelectRow("default", defaultOptions, native.default || "", (val) => {
      commitEdit(
        node,
        "native",
        "default",
        val || undefined,
        "Set enum default to " + (val || "none"),
      );
    }),
  );
}

function renderFixedDetails(node, panel) {
  const native = node.attributes.native;

  panel.appendChild(
    buildNameNamespaceRow(
      native.name || "",
      native.namespace || "",
      (val) =>
        commitEdit(node, "native", "name", val, "Rename fixed to " + val),
      (val) =>
        commitEdit(
          node,
          "native",
          "namespace",
          val || undefined,
          "Change namespace to " + (val || "none"),
        ),
    ),
  );

  panel.appendChild(
    buildEditableRow("size", String(native.size || 0), (val, input) => {
      const result = validateFixedSize(val);
      if (!applyValidation(input, result)) return;
      const numVal = parseInt(val, 10);
      commitEdit(node, "native", "size", numVal, "Change size to " + numVal);
    }),
  );
}

function renderPrimitiveDetails(node, panel) {
  const native = node.attributes.native;

  if (typeof native === "string") {
    panel.appendChild(buildReadonlyRow("type", native));
    return;
  }

  // Complex primitive (has logicalType or extra attrs)
  panel.appendChild(buildReadonlyRow("base type", native.type));

  // Logical type (select from valid options for this base type)
  const validLogicals = LOGICAL_TYPES[native.type] || [""];
  if (validLogicals.length > 1) {
    panel.appendChild(
      buildSelectRow(
        "logicalType",
        validLogicals,
        native.logicalType || "",
        (val) => {
          commitEdit(
            node,
            "native",
            "logicalType",
            val || undefined,
            "Change logicalType to " + (val || "none"),
          );
        },
      ),
    );
  } else if (native.logicalType) {
    panel.appendChild(buildReadonlyRow("logicalType", native.logicalType));
  }

  // Extra attrs (precision, scale for decimal)
  if (native.logicalType && LOGICAL_TYPES_ATTRS[native.logicalType]) {
    const extras = LOGICAL_TYPES_ATTRS[native.logicalType];
    for (const attr of Object.keys(extras)) {
      panel.appendChild(
        buildEditableRow(attr, String(native[attr] || 0), (val, input) => {
          const numVal = parseInt(val, 10);
          if (isNaN(numVal)) {
            applyValidation(input, {
              valid: false,
              message: attr + " must be a number",
            });
            return;
          }
          // Decimal-specific validation
          if (native.logicalType === "decimal") {
            let result;
            if (attr === "precision") {
              result = validateDecimalPrecision(val);
            } else if (attr === "scale") {
              result = validateDecimalScale(val, native.precision);
            }
            if (result && !applyValidation(input, result)) return;
          }
          commitEdit(
            node,
            "native",
            attr,
            numVal,
            "Change " + attr + " to " + numVal,
          );
        }),
      );
    }
  }
}

function renderUnionDetails(node, panel) {
  // Branch list with remove buttons
  const section = el("div", RENDER.CLS_DETAIL_LIST);
  section.appendChild(el("h4", RENDER.CLS_DETAIL_HEADING, "branches"));

  (node.children || []).forEach((childId) => {
    const child = currentProjection.nodes.get(childId);
    if (!child) return;
    const nat = child.attributes.native;
    const label =
      typeof nat === "string"
        ? nat
        : nat.logicalType || nat.type || nat.name || child.kind;

    const itemRow = el("div", RENDER.CLS_DETAIL_LIST_ITEM);
    itemRow.appendChild(span("", label));

    // Remove button (only if union has > 1 branch)
    if (node.children.length > 1) {
      const removeBtn = document.createElement("button");
      removeBtn.className = RENDER.CLS_DETAIL_REMOVE_BTN;
      removeBtn.textContent = "×";
      removeBtn.title = "Remove " + label;
      removeBtn.addEventListener("click", () => {
        const cmd = removeNodeCommand(
          { nodeId: childId },
          currentProjection,
          refreshAfterMutation,
        );
        executeCommand(cmd);
      });
      itemRow.appendChild(removeBtn);
    }
    section.appendChild(itemRow);
  });

  // Add branch button with type picker
  const existingBranchTypes = (node.children || []).map((cid) => {
    const c = currentProjection.nodes.get(cid);
    if (!c) return "";
    const n = c.attributes.native;
    return typeof n === "string" ? n : n.type || n.name || c.kind;
  });

  const addRow = el("div", RENDER.CLS_DETAIL_LIST_ITEM);
  const addSelect = buildTypeSelect("+ add type");
  addSelect.dataset.listSection = "branches";
  addSelect.addEventListener("change", () => {
    const val = addSelect.value;
    if (!val) return;
    // Validate: no nested unions, no duplicate primitives
    const branchResult = validateUnionBranchAdd(
      val,
      existingBranchTypes,
      node.kind,
    );
    if (!branchResult.valid) {
      warningToast(branchResult.message);
      addSelect.value = "";
      return;
    }
    const spec = TYPE_TEMPLATES[val] || val;
    const newSubtree = buildTypeSubtree(spec);
    const cmd = createNodeCommand(
      { newSubtree, targetNodeId: node.id, slot: SLOT.UNION_BRANCH },
      currentProjection,
      refreshAfterMutation,
    );
    executeCommand(cmd);
    refocusListInput("branches");
  });
  addRow.appendChild(addSelect);
  section.appendChild(addRow);

  panel.appendChild(section);
}

function renderArrayDetails(node, panel) {
  if (node.children.length > 0) {
    const itemsNode = currentProjection.nodes.get(node.children[0]);
    if (itemsNode) {
      const label = getNodeTypeLabel(itemsNode, currentProjection);
      panel.appendChild(buildReplaceTypeRow("inner type", label, node.id));
    }
  }
}

function renderMapDetails(node, panel) {
  if (node.children.length > 0) {
    const valuesNode = currentProjection.nodes.get(node.children[0]);
    if (valuesNode) {
      const label = getNodeTypeLabel(valuesNode, currentProjection);
      panel.appendChild(buildReplaceTypeRow("inner type", label, node.id));
    }
  }
}

// ─── Custom Attributes Section ───────────────────────────────────────────────

/**
 * Custom attributes = any key in native that isn't standard for this node kind.
 * Reads from native (so emitter picks them up automatically).
 * Writes to native scope (so export works without additional merging).
 */
function renderCustomAttributes(node, panel) {
  const native = node.attributes.native;
  if (typeof native !== "object" || native === null) return;

  const standardKeys = STANDARD_NATIVE_KEYS[node.kind] || new Set();
  const customKeys = Object.keys(native).filter((k) => !standardKeys.has(k));

  panel.appendChild(el("h4", RENDER.CLS_DETAIL_HEADING, "Custom Attributes"));

  // Show existing custom attributes (editable with remove)
  for (const key of customKeys) {
    const val = native[key];
    const displayVal =
      typeof val === "object" ? JSON.stringify(val) : String(val);
    const row = el("div", RENDER.CLS_DETAIL_ROW);
    row.appendChild(span(RENDER.CLS_DETAIL_KEY, key));

    const input = document.createElement("input");
    input.type = "text";
    input.className = RENDER.CLS_DETAIL_INPUT;
    input.value = displayVal;
    input.addEventListener("change", () => {
      let parsed = input.value;
      try {
        parsed = JSON.parse(parsed);
      } catch (_) {
        /* keep as string */
      }
      commitEdit(node, "native", key, parsed, "Update " + key);
    });
    input.addEventListener("keydown", detailInputKeydown);
    row.appendChild(input);

    // Remove button
    const removeBtn = document.createElement("button");
    removeBtn.className = RENDER.CLS_DETAIL_REMOVE_BTN;
    removeBtn.textContent = "×";
    removeBtn.title = "Remove " + key;
    removeBtn.addEventListener("click", () => {
      commitEdit(node, "native", key, undefined, "Remove " + key);
    });
    row.appendChild(removeBtn);
    panel.appendChild(row);
  }

  // Add new custom attribute (inline key + value)
  const addRow = el("div", RENDER.CLS_DETAIL_ROW);
  const keyInput = document.createElement("input");
  keyInput.type = "text";
  keyInput.className = RENDER.CLS_DETAIL_INPUT;
  keyInput.placeholder = "key";
  keyInput.style.maxWidth = "80px";
  keyInput.dataset.listSection = "custom-attrs";

  const valInput = document.createElement("input");
  valInput.type = "text";
  valInput.className = RENDER.CLS_DETAIL_INPUT;
  valInput.placeholder = "value";

  // Shared confirm logic for add button and Enter key
  const confirmAdd = () => {
    const k = keyInput.value.trim();
    const v = valInput.value.trim();
    if (!k) return;
    let parsed = v;
    try {
      parsed = JSON.parse(v);
    } catch (_) {
      /* keep as string */
    }
    commitEdit(node, "native", k, parsed, "Add " + k);
    refocusListInput("custom-attrs");
  };

  const addBtn = document.createElement("button");
  addBtn.className = RENDER.CLS_DETAIL_ADD_BTN;
  addBtn.textContent = "+";
  addBtn.title = "Add custom attribute";
  addBtn.addEventListener("click", confirmAdd);

  keyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      valInput.focus();
    } else detailInputKeydown(e);
  });
  valInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmAdd();
    } else detailInputKeydown(e);
  });

  addRow.appendChild(keyInput);
  addRow.appendChild(valInput);
  addRow.appendChild(addBtn);
  panel.appendChild(addRow);
}

// ─── Detail Panel Builders ───────────────────────────────────────────────────

function commitEdit(node, scope, key, newValue, description) {
  const cmd = updateAttributeCommand(
    { nodeId: node.id, scope, key, newValue, description },
    currentProjection,
    refreshAfterMutation,
  );
  executeCommand(cmd);
}

function buildReadonlyRow(label, value) {
  const row = el("div", RENDER.CLS_DETAIL_ROW);
  const keySpan = span(RENDER.CLS_DETAIL_KEY, label);
  if (DETAIL_TOOLTIPS[label]) keySpan.title = DETAIL_TOOLTIPS[label];
  row.appendChild(keySpan);
  row.appendChild(span(RENDER.CLS_DETAIL_VALUE, value));
  return row;
}

function buildEditableRow(label, value, onChange) {
  const row = el("div", RENDER.CLS_DETAIL_ROW);
  const keySpan = span(RENDER.CLS_DETAIL_KEY, label);
  if (DETAIL_TOOLTIPS[label]) keySpan.title = DETAIL_TOOLTIPS[label];
  row.appendChild(keySpan);
  const input = document.createElement("input");
  input.type = "text";
  input.className = RENDER.CLS_DETAIL_INPUT;
  input.value = value;
  input.addEventListener("change", () => onChange(input.value, input));
  input.addEventListener("keydown", detailInputKeydown);
  row.appendChild(input);
  return row;
}

function buildNameNamespaceRow(name, namespace, onNameChange, onNsChange) {
  const row = el("div", "name-ns-row");

  const nameKey = span(RENDER.CLS_DETAIL_KEY, "name");
  nameKey.title = VALIDATION_HINTS.name;
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = RENDER.CLS_DETAIL_INPUT;
  nameInput.value = name;
  nameInput.addEventListener("change", () => {
    const result = validateName(nameInput.value);
    if (!applyValidation(nameInput, result)) return;
    onNameChange(nameInput.value);
  });
  nameInput.addEventListener("keydown", detailInputKeydown);

  const nsKey = span(RENDER.CLS_DETAIL_KEY, "ns");
  nsKey.title = VALIDATION_HINTS.namespace;
  const nsInput = document.createElement("input");
  nsInput.type = "text";
  nsInput.className = RENDER.CLS_DETAIL_INPUT;
  nsInput.placeholder = "(namespace)";
  nsInput.value = namespace;
  nsInput.addEventListener("change", () => {
    const result = validateNamespace(nsInput.value);
    if (!applyValidation(nsInput, result)) return;
    onNsChange(nsInput.value);
  });
  nsInput.addEventListener("keydown", detailInputKeydown);

  row.appendChild(nameKey);
  row.appendChild(nameInput);
  row.appendChild(nsKey);
  row.appendChild(nsInput);
  return row;
}

function buildTextareaRow(label, value, onChange) {
  const row = el("div", RENDER.CLS_DETAIL_ROW);
  const keySpan = span(RENDER.CLS_DETAIL_KEY, label);
  if (DETAIL_TOOLTIPS[label]) keySpan.title = DETAIL_TOOLTIPS[label];
  row.appendChild(keySpan);
  const textarea = document.createElement("textarea");
  textarea.className = RENDER.CLS_DETAIL_TEXTAREA;
  textarea.value = value;
  textarea.rows = 2;
  textarea.addEventListener("change", () => onChange(textarea.value));
  textarea.addEventListener("keydown", detailInputKeydown);
  row.appendChild(textarea);
  return row;
}

function buildSelectRow(label, options, selected, onChange) {
  const row = el("div", RENDER.CLS_DETAIL_ROW);
  const keySpan = span(RENDER.CLS_DETAIL_KEY, label);
  if (DETAIL_TOOLTIPS[label]) keySpan.title = DETAIL_TOOLTIPS[label];
  row.appendChild(keySpan);
  const select = document.createElement("select");
  select.className = RENDER.CLS_DETAIL_SELECT;
  for (const opt of options) {
    const option = document.createElement("option");
    option.value = opt;
    option.textContent = opt || "(none)";
    if (opt === selected) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener("change", () => onChange(select.value));
  select.addEventListener("keydown", detailInputKeydown);
  row.appendChild(select);
  return row;
}

/**
 * Type replacement row: shows current type label + a select to change it.
 * Uses TYPE_TEMPLATES for complex types, primitives pass through.
 * After replacement, auto-focuses the new type node in the tree.
 */
/**
 * Build a <select> with all available type options: primitives, complex templates, and named types.
 * @param {string} placeholder - Text for the empty default option
 * @returns {HTMLSelectElement}
 */
function buildTypeSelect(placeholder) {
  const select = document.createElement("select");
  select.className = RENDER.CLS_DETAIL_SELECT;

  // Placeholder
  const emptyOpt = document.createElement("option");
  emptyOpt.value = "";
  emptyOpt.textContent = placeholder;
  select.appendChild(emptyOpt);

  // Primitives
  for (const t of PRIMITIVE_TYPES) {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    select.appendChild(opt);
  }

  // Complex templates
  for (const t of COMPLEX_TYPES) {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    select.appendChild(opt);
  }

  if (OPTIONS.SHOW_NAMED_TYPES_ON_SELECT) {
    // Named types from current schema
    const namedTypes = getNamedTypes(currentProjection);
    if (namedTypes.length > 0) {
      const group = document.createElement("optgroup");
      group.label = "── schema types ──";
      for (const name of namedTypes) {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        group.appendChild(opt);
      }
      select.appendChild(group);
    }
  }

  return select;
}

function buildReplaceTypeRow(label, currentTypeLabel, parentNodeId) {
  const wrapper = el("div", "type-row-wrapper");
  const row = el("div", RENDER.CLS_DETAIL_ROW);
  row.appendChild(span(RENDER.CLS_DETAIL_KEY, label));
  row.appendChild(span(RENDER.CLS_DETAIL_VALUE, currentTypeLabel));
  wrapper.appendChild(row);

  const select = buildTypeSelect("\u21C4 change type");
  select.addEventListener("change", () => {
    const val = select.value;
    if (!val) return;
    // Prevent nested union
    const parentNode = currentProjection.nodes.get(parentNodeId);
    if (parentNode && parentNode.kind === "union" && val === "union") {
      warningToast("Unions cannot be nested (Avro spec)");
      select.value = "";
      return;
    }
    const spec = TYPE_TEMPLATES[val] || val;
    const cmd = replaceTypeCommand(
      {
        parentNodeId,
        newTypeSpec: spec,
        description: "Replace type \u2192 " + val,
      },
      currentProjection,
      refreshAfterMutation,
    );
    executeCommand(cmd);
    // Auto-focus the new type child so user can configure it
    const parent = currentProjection.nodes.get(parentNodeId);
    if (parent && parent.children[0]) {
      expandedNodeIds.add(parentNodeId);
      focusNodeById(parent.children[0]);
    }
  });
  select.addEventListener("keydown", detailInputKeydown);
  wrapper.appendChild(select);
  return wrapper;
}

/** After list mutation re-renders the panel, refocus the add input for the given section */
function refocusListInput(sectionTitle) {
  requestAnimationFrame(() => {
    const panel = document.getElementById(RENDER.ID_DETAIL_PANEL);
    if (!panel) return;
    const input = panel.querySelector(
      '[data-list-section="' + sectionTitle + '"]',
    );
    if (input) input.focus();
  });
}

/** Escape from detail inputs → blur and focus tree */
function detailInputKeydown(e) {
  if (e.key === "Escape") {
    e.preventDefault();
    e.target.blur();
    const tree = document.getElementById(RENDER.ID_TREE);
    if (tree) tree.focus();
  }
}

function buildListSection(title, items) {
  const section = el("div", RENDER.CLS_DETAIL_LIST);
  section.appendChild(el("h4", RENDER.CLS_DETAIL_HEADING, title));
  for (const item of items) {
    const itemEl = el("div", RENDER.CLS_DETAIL_LIST_ITEM, item);
    section.appendChild(itemEl);
  }
  return section;
}

/**
 * Editable list section (aliases, symbols).
 * Each item has a remove button, and there's an add input at the bottom.
 * Changes are committed as array replacement via updateAttributeCommand.
 */
function buildEditableListSection(title, items, node, scope, key, validator) {
  const section = el("div", RENDER.CLS_DETAIL_LIST);
  section.appendChild(el("h4", RENDER.CLS_DETAIL_HEADING, title));

  for (let i = 0; i < items.length; i++) {
    const itemRow = el("div", RENDER.CLS_DETAIL_LIST_ITEM);
    itemRow.appendChild(span("", items[i]));

    const removeBtn = document.createElement("button");
    removeBtn.className = RENDER.CLS_DETAIL_REMOVE_BTN;
    removeBtn.textContent = "×";
    removeBtn.title = "Remove " + items[i];
    const idx = i;
    removeBtn.addEventListener("click", () => {
      const newList = [...items];
      newList.splice(idx, 1);
      commitEdit(
        node,
        scope,
        key,
        newList.length > 0 ? newList : undefined,
        "Remove " + title + " item",
      );
    });
    itemRow.appendChild(removeBtn);
    section.appendChild(itemRow);
  }

  // Add new item row
  const addRow = el("div", RENDER.CLS_DETAIL_LIST_ITEM);
  const addInput = document.createElement("input");
  addInput.type = "text";
  addInput.className = RENDER.CLS_DETAIL_INPUT;
  addInput.placeholder = "+ add " + title.slice(0, -1);
  addInput.dataset.listSection = title;

  const doAdd = () => {
    const val = addInput.value.trim();
    if (!val) return;
    if (validator) {
      const result = validator(val, items);
      if (!applyValidation(addInput, result)) return;
    }
    const newList = [...items, val];
    commitEdit(node, scope, key, newList, "Add " + title + " item: " + val);
    refocusListInput(title);
  };

  addInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doAdd();
    }
    detailInputKeydown(e);
  });

  const addBtn = document.createElement("button");
  addBtn.className = RENDER.CLS_DETAIL_ADD_BTN;
  addBtn.textContent = "+";
  addBtn.addEventListener("click", doAdd);

  addRow.appendChild(addInput);
  addRow.appendChild(addBtn);
  section.appendChild(addRow);
  return section;
}

// ─── Keyboard Handler ────────────────────────────────────────────────────────

function handleTreeKeydown(e) {
  const tree = document.getElementById(RENDER.ID_TREE);
  if (!tree) return;

  // Move mode intercepts all keys
  if (moveMode && handleMoveModeKey(e)) return;

  // Don't capture keys when user is in an input/textarea/select
  const active = document.activeElement;
  const isInputFocused =
    active &&
    (active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      active.tagName === "SELECT");
  if (isInputFocused) return;

  const key = e.key;

  switch (key) {
    case "ArrowDown":
    case "j":
      e.preventDefault();
      moveFocus(1);
      break;

    case "ArrowUp":
    case "k":
      e.preventDefault();
      moveFocus(-1);
      break;

    case "ArrowRight":
    case "l":
      e.preventDefault();
      expandFocused();
      break;

    case "ArrowLeft":
    case "h":
      e.preventDefault();
      collapseFocused();
      break;

    case "Home":
      e.preventDefault();
      focusFirst();
      break;

    case "End":
      e.preventDefault();
      focusLast();
      break;

    case "g":
      e.preventDefault();
      focusFirst();
      break;

    case "G":
      e.preventDefault();
      focusLast();
      break;

    case " ":
      e.preventDefault();
      if (getFocusedNodeId()) toggleExpand(getFocusedNodeId());
      break;

    case "Enter": {
      e.preventDefault();
      const nodeId = getFocusedNodeId();
      if (nodeId) {
        renderNodeDetails(currentProjection.nodes.get(nodeId));
        // Focus first editable input in the detail panel
        const panel = document.getElementById(RENDER.ID_DETAIL_PANEL);
        if (panel) {
          const firstInput = panel.querySelector(
            "input." +
              RENDER.CLS_DETAIL_INPUT +
              ", select." +
              RENDER.CLS_DETAIL_SELECT,
          );
          if (firstInput) {
            firstInput.focus();
            if (firstInput.tagName === "INPUT") firstInput.select();
          }
        }
      }
      break;
    }

    // Action shortcuts
    case "a":
      e.preventDefault();
      if (getFocusedNodeId()) actionAdd(getFocusedNodeId());
      break;

    case "d":
    case "Delete":
      e.preventDefault();
      if (getFocusedNodeId()) actionRemove(getFocusedNodeId());
      break;

    case "c":
      if (!e.ctrlKey) {
        e.preventDefault();
        if (getFocusedNodeId()) actionCopy(getFocusedNodeId());
      }
      break;

    case "r":
      if (e.ctrlKey) {
        e.preventDefault();
        redo();
      } else {
        e.preventDefault();
        if (getFocusedNodeId()) actionReplace();
      }
      break;

    case "m":
      e.preventDefault();
      if (getFocusedNodeId()) actionMoveMode();
      break;

    case "u":
      e.preventDefault();
      undo();
      break;

    case "F2": {
      e.preventDefault();
      actionRename();
      break;
    }

    // Search shortcuts
    case "/":
      e.preventDefault();
      document.getElementById(RENDER.ID_SEARCH_INPUT)?.focus();
      break;

    case "n":
      if (!e.ctrlKey && searchActive) {
        e.preventDefault();
        nextSearchMatch();
      }
      break;

    case "N":
      if (!e.ctrlKey && searchActive) {
        e.preventDefault();
        prevSearchMatch();
      }
      break;

    case "Escape":
      if (moveMode) {
        e.preventDefault();
        cancelMoveMode();
      } else if (searchActive) {
        e.preventDefault();
        const searchInput = document.getElementById(RENDER.ID_SEARCH_INPUT);
        if (searchInput) searchInput.value = "";
        clearSearch();
      }
      break;
  }
}

// ─── Initialization ──────────────────────────────────────────────────────────

function startRender() {
  const tree = document.getElementById(RENDER.ID_TREE);
  if (!tree) return;

  // Click: focus node
  tree.addEventListener("click", (e) => {
    if (e.target.closest("." + RENDER.CLS_ACTIONS)) return;
    const row = e.target.closest("[data-node-id]");
    if (row) focusNodeById(row.dataset.nodeId);
  });

  // Keyboard navigation
  document.addEventListener("keydown", handleTreeKeydown);

  // Search input: debounced query on each keystroke
  const searchInput = document.getElementById(RENDER.ID_SEARCH_INPUT);
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      clearTimeout(searchDebounceTimer);
      if (!searchInput.value.trim()) {
        // Input cleared — show history dropdown, reset search state
        searchResults = [];
        searchFocusIdx = -1;
        searchActive = false;
        if (currentProjection) renderProjection(currentProjection);
        updateSearchCounter();
        showSearchHistory();
      } else {
        hideSearchHistory();
        searchDebounceTimer = setTimeout(() => {
          executeSearch(searchInput.value);
        }, RENDER.SEARCH_DEBOUNCE_MS);
      }
    });

    searchInput.addEventListener("keydown", handleSearchKeydown);

    // Show history dropdown on focus (only when input is empty)
    searchInput.addEventListener("focus", () => {
      if (!searchInput.value.trim()) {
        showSearchHistory();
      }
    });

    // Hide history dropdown on blur
    searchInput.addEventListener("blur", () => {
      // Delay to allow mousedown on dropdown items to fire first
      setTimeout(hideSearchHistory, 150);
    });
  }
}

/**
 * Reset render state (for loading a new schema).
 */
function resetRenderState() {
  expandedNodeIds = new Set();
  flatVisibleNodes = [];
  focusedIndex = -1;
  searchResults = [];
  searchFocusIdx = -1;
  searchActive = false;
  clearTimeout(searchDebounceTimer);
  clearDetailPanel();
}

function clearDetailPanel() {
  const panel = document.getElementById(RENDER.ID_DETAIL_PANEL);
  if (!panel) return;
  while (panel.firstChild) panel.removeChild(panel.firstChild);
  const placeholder = el(
    "div",
    "side-placeholder",
    "Select a node to see details",
  );
  panel.appendChild(placeholder);
  const sidePanel = panel.closest(".side-panel");
  if (sidePanel) sidePanel.classList.remove("panel-active");
}
