/* ==========================================================================
   Avro Schema Validation Rules (Phase 4b)
   Pure functions — each returns { valid, message }
   ========================================================================== */

const AVRO_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ─── Core validators ─────────────────────────────────────────────────────────

function validateName(value) {
  if (!value || !value.trim()) {
    return { valid: false, message: "Name is required" };
  }
  if (!AVRO_NAME_RE.test(value)) {
    return {
      valid: false,
      message: "Name must start with [A-Za-z_] and contain only [A-Za-z0-9_]",
    };
  }
  return { valid: true, message: "" };
}

function validateNamespace(value) {
  if (!value || value.trim() === "") return { valid: true, message: "" };
  const segments = value.split(".");
  for (const seg of segments) {
    if (!AVRO_NAME_RE.test(seg)) {
      return {
        valid: false,
        message: "Each namespace segment must match [A-Za-z_][A-Za-z0-9_]*",
      };
    }
  }
  return { valid: true, message: "" };
}

function validateSymbol(value, existingSymbols) {
  const nameResult = validateName(value);
  if (!nameResult.valid) return nameResult;
  if (existingSymbols && existingSymbols.includes(value)) {
    return { valid: false, message: "Duplicate symbol: " + value };
  }
  return { valid: true, message: "" };
}

function validateFixedSize(value) {
  const num = parseInt(value, 10);
  if (isNaN(num) || num <= 0) {
    return { valid: false, message: "Fixed size must be an integer > 0" };
  }
  return { valid: true, message: "" };
}

function validateDecimalPrecision(value) {
  const num = parseInt(value, 10);
  if (isNaN(num) || num <= 0) {
    return { valid: false, message: "Precision must be > 0" };
  }
  return { valid: true, message: "" };
}

function validateDecimalScale(value, precision) {
  const num = parseInt(value, 10);
  const prec = parseInt(precision, 10);
  if (isNaN(num) || num < 0) {
    return { valid: false, message: "Scale must be ≥ 0" };
  }
  if (!isNaN(prec) && num > prec) {
    return { valid: false, message: "Scale must be ≤ precision (" + prec + ")" };
  }
  return { valid: true, message: "" };
}

function validateUnionBranchAdd(newType, existingBranches, parentKind) {
  if (parentKind === "union") {
    if (newType === "union") {
      return { valid: false, message: "Unions cannot be nested" };
    }
  }
  // Check duplicates for primitives and unnamed complex types
  const primitiveAndSimple = [
    "null", "boolean", "int", "long", "float", "double", "bytes", "string",
    "array", "map",
  ];
  if (primitiveAndSimple.includes(newType)) {
    if (existingBranches.includes(newType)) {
      return { valid: false, message: "Union already contains type: " + newType };
    }
  }
  return { valid: true, message: "" };
}

function validateNoNestedUnion(newType, parentKind) {
  if (newType === "union" && parentKind === "union") {
    return { valid: false, message: "Unions cannot be nested (Avro spec)" };
  }
  return { valid: true, message: "" };
}

// ─── Tooltip hints (used as title attributes) ────────────────────────────────

const VALIDATION_HINTS = {
  name: "Must start with [A-Za-z_], then [A-Za-z0-9_]",
  namespace: "Dot-separated segments, each matching name rules (or empty)",
  symbol: "Same as name rules; must be unique in the enum",
  fixedSize: "Integer greater than 0",
  precision: "Integer > 0 (required for decimal)",
  scale: "Integer ≥ 0 and ≤ precision",
};

// ─── Helper: apply validation to an input element ────────────────────────────

function applyValidation(input, result) {
  if (result.valid) {
    input.classList.remove("invalid");
    input.title = "";
  } else {
    input.classList.add("invalid");
    input.title = result.message;
    warningToast(result.message);
  }
  return result.valid;
}
