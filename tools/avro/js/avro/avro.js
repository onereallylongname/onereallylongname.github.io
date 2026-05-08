/* ==========================================================================
  Avro Schema Editor — v2.0-1 (pre-release)
===========================================================================*/

const EDITOR_VERSION = "2.0-2";

/* ==========================================================================
  UI
===========================================================================*/

function refreshAfterMutation() {
  rebuildPaths(currentProjection); // derived only
  currentSchema = generateAvroFromProjection(currentProjection);
  renderSchemaTree();
  refreshUndoRedoUI();
  // Re-render detail panel if a node is focused
  if (focusedIndex >= 0 && flatVisibleNodes[focusedIndex]) {
    const focusedNode = currentProjection.nodes.get(
      flatVisibleNodes[focusedIndex].id,
    );
    if (focusedNode) renderNodeDetails(focusedNode);
  }
}

function refreshUndoRedoUI() {
  const historyIndex = document.getElementById("historyIndex");
  const undoBtn = document.getElementById("undoBtn");
  const redoBtn = document.getElementById("redoBtn");
  // enable/disable buttons
  undoBtn.disabled = window.undoStack.length === 0;
  redoBtn.disabled = window.redoStack.length === 0;

  // update history index display
  historyIndex.textContent = `${window.undoStack.length}/${window.undoStack.length + window.redoStack.length}`;
  if (!undoBtn.disabled) {
    historyIndex.title = `Last change ${window.undoStack[window.undoStack.length - 1].desc}`;
  } else if (!redoBtn.disabled) {
    historyIndex.title = `Next change ${window.redoStack[window.redoStack.length - 1].desc}`;
  }
}

/* ==========================================================================
  Error banner
==========================================================================*/

function showSchemaError(msg) {
  const el = document.getElementById("schemaLoadError");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function clearSchemaError() {
  const el = document.getElementById("schemaLoadError");
  el.textContent = "";
  el.classList.add("hidden");
}
/* ==========================================================================
  START UP PAGE
===========================================================================*/

// Undo/Redo button clicks
document.getElementById("undoBtn").addEventListener("click", () => undo());
document.getElementById("redoBtn").addEventListener("click", () => redo());

// New schema
document.getElementById("newAvscBtn").addEventListener("click", () => {
  if (currentSchema) {
    if (!confirm("Do you want to overwrite the current schema?")) return;
  }

  const newSchema = {
    type: "record",
    name: "NewRecord",
    namespace: "",
    fields: [],
  };

  currentSchema = newSchema;
  updateCurrentSchema(currentSchema);
  resetRenderState();
  currentProjection = buildProjection(currentSchema);
  refreshAfterMutation();
});

/* ==========================================================================
  Shortcuts
==========================================================================*/

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === "z" && !e.shiftKey) {
    e.preventDefault();
    undo();
  }
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "z") {
    e.preventDefault();
    redo();
  }

  // --------------------------
  // CTRL + SHIFT + F → focus search
  // --------------------------
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "f") {
    e.preventDefault();
    const search = document.getElementById("sideSearchInput");
    if (search) search.focus();
    return;
  }

  // --------------------------
  // CTRL + SHIFT + O → open file chooser
  // --------------------------
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "o") {
    e.preventDefault();
    const fileInput = document.getElementById("avscFileInput");
    if (fileInput) fileInput.click();
    return;
  }

  // --------------------------
  // CTRL + SHIFT + J → toggle JSON textarea
  // --------------------------
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "j") {
    e.preventDefault();
    toggleJsonEditor();
    return;
  }

  // --------------------------
  // ESC → close JSON editor
  // --------------------------
  if (e.key === "Escape") {
    const area = document.getElementById("jsonInputArea");
    if (document.activeElement === area) {
      toggleJsonEditor(false);
      return;
    }
  }

  // --------------------------
  // CTRL + SHIFT + C → copy AVRO to clipboard
  // --------------------------
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "c") {
    e.preventDefault();
    exportSchemaToClipboard();
    return;
  }

  // --------------------------
  // CTRL + SHIFT + E → export AVSC file
  // --------------------------
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "e") {
    e.preventDefault();
    exportSchemaToFile();
    return;
  }
});

// IO
startIO(
  () => {
    clearSchemaError();
  },
  () => {
    resetRenderState();
    currentProjection = buildProjection(currentSchema);
    refreshAfterMutation();
  },
);

// Render interactions
startRender();
