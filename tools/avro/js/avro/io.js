/* ==========================================================================
  Start Variables
===========================================================================*/
let currentSchema = null;

/* ==========================================================================
  Load Schema as json
==========================================================================*/

// Hook schema loader into tree display
// (from Phase 1)
function loadSchemaFromText(text) {
  clearSchemaError();

  try {
    const json = JSON.parse(text);

    if (!json.type) {
      throw new Error("Not a valid Avro schema: missing 'type' field");
    }

    updateCurrentSchema(json);
  } catch (err) {
    console.error(err);
    showSchemaError(err.message);
  }
}

function updateCurrentSchema(newSchema) {
  let oldSchema;
  executeCommand(
    new Command(
      () => {
        oldSchema = currentSchema;
        currentSchema = newSchema;
      },
      () => {
        currentSchema = oldSchema;
        oldSchema = newSchema;
      },
      () => renderSchemaTree(),
      "Load schema from textarea",
    ),
  );
}

/* ==========================================================================
  Json text input
==========================================================================*/

function toggleJsonEditor(open = true) {
  const area = document.getElementById("jsonInputArea");
  const btn = document.getElementById("jsonToggleBtn");

  const isHidden = area.classList.contains("hidden");

  if (isHidden && open) {
    area.classList.remove("hidden");
    btn.classList.add("active");
    btn.textContent = "Hide JSON Input";
    area.focus();
  } else {
    area.classList.add("hidden");
    btn.classList.remove("active");
    btn.textContent = "AVSC JSON";
  }
}

/* ==========================================================================
  Export
==========================================================================*/

function serializeCurrentSchema(pretty = true) {
  if (!currentSchema) {
    warningToast("No schema to export");
    return null;
  }

  return pretty
    ? JSON.stringify(currentSchema, null, 2)
    : JSON.stringify(currentSchema);
}

async function exportSchemaToClipboard() {
  const text = serializeCurrentSchema(true);
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    successToast("Avro schema copied to clipboard");
  } catch (err) {
    console.error(err);
    warningToast("Clipboard copy failed");
  }
}

function exportSchemaToFile() {
  const text = serializeCurrentSchema(true);
  if (!text) return;

  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const name = (currentSchema?.name || "schema") + ".avsc";

  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);

  successToast(`Downloaded ${name}`);
}

function updateExportUI() {
  const disabled = !currentSchema;
  document.getElementById("exportClipboardBtn").disabled = disabled;
  document.getElementById("exportFileBtn").disabled = disabled;
}

/* ==========================================================================
  INITIALIZE 
==========================================================================*/

function startIO(preApdateAction, posApdateAction) {
  document
    .getElementById("avscFileInput")
    .addEventListener("change", async (evt) => {
      const file = evt.target.files[0];
      if (!file) return;

      try {
        if (preApdateAction) preApdateAction();
        const text = await file.text();
        loadSchemaFromText(text);
        if (posApdateAction) posApdateAction();
      } catch (err) {
        showSchemaError("Failed to read file: " + err.message);
      }
    });

  // JSON text input button
  document.getElementById("jsonToggleBtn").addEventListener("click", () => {
    toggleJsonEditor();
  });

  document.getElementById("jsonInputArea").addEventListener("blur", () => {
    const text = document.getElementById("jsonInputArea").value.trim();
    if (text) {
      try {
        if (preApdateAction) preApdateAction();
        loadSchemaFromText(text);
        if (posApdateAction) posApdateAction();
      } catch (err) {
        showSchemaError("Failed to parse JSON: " + err.message);
      }
    }
  });

  // Export startup
  document
    .getElementById("exportClipboardBtn")
    ?.addEventListener("click", exportSchemaToClipboard);

  document
    .getElementById("exportFileBtn")
    ?.addEventListener("click", exportSchemaToFile);
}
