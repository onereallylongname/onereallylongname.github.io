/**
 * Avro Schema Editor — Test Suite
 * ================================
 * Purpose:
 *   Validates the projection layer (the core data model) that powers the editor.
 *   Covers: normalizeType, buildProjection, roundtrip emit, all action commands
 *   (remove, move, copy, create, update attributes), undo/redo, rebuildPaths,
 *   and cloneSubtree integrity.
 *
 * Usage:
 *   node tests/run.js
 *
 * Environment:
 *   Node.js (no browser required). Browser APIs (crypto, window) are polyfilled.
 *   Source files are eval'd with `const` → `var` to expose globals in test scope.
 *
 * Adding tests:
 *   Use the test(name, fn) harness. Assertions: assert(cond, msg), assertEqual(a, b, msg).
 *   Each test should be self-contained (call resetUndo() if using undo system).
 *
 * No external dependencies — pure JS, runs anywhere Node 18+ is available.
 */

const fs = require("fs");
const path = require("path");

// ─── Test Harness ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "Assertion failed");
}

function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg || "assertEqual"}\n  expected: ${e}\n  actual:   ${a}`);
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message });
    console.log(`  \u2717 ${name}`);
    console.log(`    ${e.message.split("\n")[0]}`);
  }
}

// ─── Load Source Code ────────────────────────────────────────────────────────

global.window = global;

// Minimal DOM mock for render.js functions that don't need full DOM
global.document = {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: (tag) => ({
    tagName: tag.toUpperCase(),
    className: "",
    textContent: "",
    dataset: {},
    style: {},
    children: [],
    setAttribute: function() {},
    getAttribute: function() { return null; },
    removeAttribute: function() {},
    addEventListener: function() {},
    appendChild: function(child) { this.children.push(child); return child; },
    classList: { add: function(){}, remove: function(){}, contains: function(){ return false; } },
    scrollIntoView: function() {},
  }),
  createDocumentFragment: () => ({
    children: [],
    appendChild: function(child) { this.children.push(child); return child; },
  }),
  activeElement: null,
};

const root = path.resolve(__dirname, "../..");
const srcFiles = [
  "js/undo.js",
  "js/strings.js",
  "js/avro/utils.js",
  "js/avro/projection.js",
  "js/avro/actions.js",
  "js/avro/search.js",
  "js/avro/render.js",
];

const code = srcFiles
  .map((f) => fs.readFileSync(path.join(root, f), "utf8"))
  .join("\n")
  .replace(/crypto\.randomUUID\(\)/g, "(Math.random().toString(36).slice(2))")
  .replace(/console\.log\(.*?Undo\/Redo system loaded.*?\);?/g, "")
  .replace(/^const /gm, "var ")
  .replace(/^let /gm, "var ");

eval(code);

// ─── Load Sample Schemas ─────────────────────────────────────────────────────

const samplesDir = path.join(root, "samples");
const sampleFiles = fs.readdirSync(samplesDir).filter((f) => f.endsWith(".avsc"));

function loadSchema(filename) {
  return JSON.parse(fs.readFileSync(path.join(samplesDir, filename), "utf8"));
}

// Helper: get record node from a simple schema projection
function getRecord(projection) {
  const schema = projection.nodes.get(projection.rootId);
  return projection.nodes.get(schema.children[0]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS — Projection Core
// ═══════════════════════════════════════════════════════════════════════════════

console.log("\n── normalizeType ───────────────────────────────────────────");

test("normalizeType: all kind variants", () => {
  // Primitives
  for (const p of PRIMITIVE_TYPES) {
    assertEqual(normalizeType(p).kind, "primitive", `${p} should be primitive`);
  }
  // Named reference
  assertEqual(normalizeType("com.example.Foo").kind, "named");
  // Union
  const u = normalizeType(["null", "string"]);
  assertEqual(u.kind, "union");
  assertEqual(u.branches.length, 2);
  // Record
  assertEqual(normalizeType({ type: "record", name: "R", fields: [] }).kind, "record");
  // Enum
  assertEqual(normalizeType({ type: "enum", name: "E", symbols: ["A"] }).kind, "enum");
  // Fixed
  assertEqual(normalizeType({ type: "fixed", name: "F", size: 16 }).kind, "fixed");
  // Array
  assertEqual(normalizeType({ type: "array", items: "int" }).kind, "array");
  // Map
  assertEqual(normalizeType({ type: "map", values: "string" }).kind, "map");
  // Logical type
  const lt = normalizeType({ type: "int", logicalType: "date" });
  assertEqual(lt.kind, "primitive");
  assertEqual(lt.logicalType, "date");
});

console.log("\n── buildProjection ─────────────────────────────────────────");

test("buildProjection: schema→record→fields→types hierarchy", () => {
  const schema = {
    type: "record", name: "Msg", namespace: "com.test",
    fields: [
      { name: "id", type: "long" },
      { name: "tags", type: { type: "array", items: "string" } },
      { name: "payload", type: ["null", { type: "record", name: "Payload", fields: [{ name: "x", type: "int" }] }] },
    ]
  };
  const p = buildProjection(schema);
  const schemaNode = p.nodes.get(p.rootId);
  assertEqual(schemaNode.kind, "schema");

  const record = p.nodes.get(schemaNode.children[0]);
  assertEqual(record.kind, "record");
  assertEqual(record.children.length, 3);

  // Field "id" → primitive
  const fId = p.nodes.get(record.children[0]);
  assertEqual(fId.kind, "field");
  assertEqual(fId.attributes.native.name, "id");
  const tId = p.nodes.get(fId.children[0]);
  assertEqual(tId.kind, "primitive");

  // Field "tags" → array
  const fTags = p.nodes.get(record.children[1]);
  const tTags = p.nodes.get(fTags.children[0]);
  assertEqual(tTags.kind, "array");
  assertEqual(tTags.children.length, 1); // items child

  // Field "payload" → union → [primitive, record]
  const fPayload = p.nodes.get(record.children[2]);
  const tPayload = p.nodes.get(fPayload.children[0]);
  assertEqual(tPayload.kind, "union");
  assertEqual(tPayload.children.length, 2);

  // union branch 1 is record with one field
  let nestedRecord = null;
  for (const node of p.nodes.values()) {
    if (node.kind === "record" && node.attributes.native.name === "Payload") {
      nestedRecord = node;
    }
  }
  assert(nestedRecord !== null, "Nested Payload record not found");
  assertEqual(nestedRecord.children.length, 1);
});

console.log("\n── Roundtrip emit ──────────────────────────────────────────");

test("roundtrip: all sample schemas produce identical JSON", () => {
  const failures = [];
  for (const file of sampleFiles) {
    const schema = loadSchema(file);
    const p = buildProjection(schema);
    const emitted = generateAvroFromProjection(p);
    if (JSON.stringify(emitted) !== JSON.stringify(schema)) {
      failures.push(file);
    }
  }
  assertEqual(failures.length, 0, `Roundtrip failed for: ${failures.join(", ")}`);
});

test("roundtrip: complex schema with enums, maps, logical types", () => {
  const schema = {
    type: "record", name: "Complex", namespace: "com.test",
    fields: [
      { name: "status", type: { type: "enum", name: "Status", symbols: ["A", "B", "C"] } },
      { name: "meta", type: { type: "map", values: "string" } },
      { name: "ts", type: { type: "long", logicalType: "timestamp-millis" } },
      { name: "data", type: { type: "fixed", name: "Hash", size: 32 } },
    ]
  };
  const p = buildProjection(schema);
  const emitted = generateAvroFromProjection(p);
  assertEqual(JSON.stringify(emitted), JSON.stringify(schema));
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS — Action Commands
// ═══════════════════════════════════════════════════════════════════════════════

console.log("\n── removeNodeCommand ───────────────────────────────────────");

test("removeNodeCommand: removes field, undo restores", () => {
  resetUndo();
  const schema = { type: "record", name: "T", fields: [{ name: "a", type: "string" }, { name: "b", type: "int" }] };
  const p = buildProjection(schema);
  const record = getRecord(p);
  const fieldAId = record.children[0];

  executeCommand(removeNodeCommand({ nodeId: fieldAId }, p, () => rebuildPaths(p)));

  // After remove
  assertEqual(record.children.length, 1);
  const emitted = generateAvroFromProjection(p);
  assertEqual(emitted.fields.length, 1);
  assertEqual(emitted.fields[0].name, "b");

  // Undo restores
  undo();
  assertEqual(record.children.length, 2);
  assertEqual(generateAvroFromProjection(p).fields[0].name, "a");

  // Redo removes again
  redo();
  assertEqual(record.children.length, 1);
  assertEqual(generateAvroFromProjection(p).fields[0].name, "b");
});

test("removeNodeCommand: remove union branch", () => {
  resetUndo();
  const schema = { type: "record", name: "T", fields: [{ name: "a", type: ["null", "string", "int"] }] };
  const p = buildProjection(schema);
  const record = getRecord(p);
  const field = p.nodes.get(record.children[0]);
  const union = p.nodes.get(field.children[0]);

  assertEqual(union.children.length, 3);
  const branchId = union.children[2]; // "int" branch

  executeCommand(removeNodeCommand({ nodeId: branchId }, p, () => rebuildPaths(p)));
  assertEqual(union.children.length, 2);

  const emitted = generateAvroFromProjection(p);
  assertEqual(emitted.fields[0].type.length, 2);

  undo();
  assertEqual(union.children.length, 3);
});

console.log("\n── moveNodeCommand ─────────────────────────────────────────");

test("moveNodeCommand: move field between records", () => {
  resetUndo();
  const schema = {
    type: "record", name: "Outer", fields: [
      { name: "a", type: "string" },
      { name: "b", type: "int" },
      { name: "inner", type: { type: "record", name: "Inner", fields: [{ name: "x", type: "long" }] } },
    ]
  };
  const p = buildProjection(schema);
  const outerRecord = getRecord(p);
  let innerRecord = null;
  for (const n of p.nodes.values()) {
    if (n.kind === "record" && n.attributes.native.name === "Inner") { innerRecord = n; break; }
  }

  const fieldBId = outerRecord.children[1];
  executeCommand(moveNodeCommand(
    { nodeId: fieldBId, targetNodeId: innerRecord.id, slot: SLOT.RECORD_FIELDS },
    p, () => rebuildPaths(p)
  ));

  assertEqual(outerRecord.children.length, 2); // "a" + "inner"
  assertEqual(innerRecord.children.length, 2); // "x" + "b"
  const emitted = generateAvroFromProjection(p);
  assertEqual(emitted.fields.length, 2);

  undo();
  assertEqual(outerRecord.children.length, 3);
  assertEqual(innerRecord.children.length, 1);
});

test("moveNodeCommand: reorder fields within same record", () => {
  resetUndo();
  const schema = { type: "record", name: "T", fields: [
    { name: "a", type: "string" },
    { name: "b", type: "int" },
    { name: "c", type: "long" },
  ]};
  const p = buildProjection(schema);
  const record = getRecord(p);

  // Move "a" (index 0) to end (index 2)
  const fieldAId = record.children[0];
  executeCommand(moveNodeCommand(
    { nodeId: fieldAId, targetNodeId: record.id, slot: SLOT.RECORD_FIELDS, index: 2 },
    p, () => rebuildPaths(p)
  ));

  const emitted = generateAvroFromProjection(p);
  assertEqual(emitted.fields[0].name, "b");
  assertEqual(emitted.fields[1].name, "c");
  assertEqual(emitted.fields[2].name, "a");

  undo();
  const restored = generateAvroFromProjection(p);
  assertEqual(restored.fields[0].name, "a");
  assertEqual(restored.fields[1].name, "b");
  assertEqual(restored.fields[2].name, "c");
});

console.log("\n── copyNodeCommand ─────────────────────────────────────────");

test("copyNodeCommand: duplicates field subtree", () => {
  resetUndo();
  const schema = { type: "record", name: "T", fields: [
    { name: "data", type: { type: "array", items: "string" } }
  ]};
  const p = buildProjection(schema);
  const record = getRecord(p);
  const fieldId = record.children[0];

  executeCommand(copyNodeCommand(
    { sourceNodeId: fieldId, targetNodeId: record.id, slot: SLOT.RECORD_FIELDS },
    p, () => rebuildPaths(p)
  ));

  assertEqual(record.children.length, 2);
  // Verify it's a deep copy (different IDs)
  assert(record.children[0] !== record.children[1], "Copy should have new ID");

  const emitted = generateAvroFromProjection(p);
  assertEqual(emitted.fields.length, 2);
  assertEqual(emitted.fields[0].type.type, "array");
  assertEqual(emitted.fields[1].type.type, "array");

  undo();
  assertEqual(record.children.length, 1);
});

console.log("\n── createNodeCommand ───────────────────────────────────────");

test("createNodeCommand: add field with union type", () => {
  resetUndo();
  const schema = { type: "record", name: "T", fields: [] };
  const p = buildProjection(schema);
  const record = getRecord(p);

  // Build field → union → [null, string]
  const fieldNode = {
    id: newNodeId(), kind: "field", parentId: null, children: [],
    attributes: { native: { name: "opt", type: ["null", "string"] }, custom: { __id: "f1" } }, path: [],
  };
  const unionNode = {
    id: newNodeId(), kind: "union", parentId: fieldNode.id, children: [],
    attributes: { native: ["null", "string"], custom: { __id: "u1" } }, path: [],
  };
  const nullNode = {
    id: newNodeId(), kind: "primitive", parentId: unionNode.id, children: [],
    attributes: { native: "null", custom: { __id: "p1" } }, path: [],
  };
  const strNode = {
    id: newNodeId(), kind: "primitive", parentId: unionNode.id, children: [],
    attributes: { native: "string", custom: { __id: "p2" } }, path: [],
  };
  unionNode.children.push(nullNode.id, strNode.id);
  fieldNode.children.push(unionNode.id);

  executeCommand(createNodeCommand(
    { newSubtree: { root: fieldNode, nodes: [fieldNode, unionNode, nullNode, strNode] }, targetNodeId: record.id, slot: SLOT.RECORD_FIELDS },
    p, () => rebuildPaths(p)
  ));

  assertEqual(record.children.length, 1);
  const emitted = generateAvroFromProjection(p);
  assertEqual(emitted.fields[0].name, "opt");
  assert(Array.isArray(emitted.fields[0].type), "Type should be union array");
  assertEqual(emitted.fields[0].type.length, 2);

  undo();
  assertEqual(record.children.length, 0);
});

console.log("\n── updateAttributeCommand ──────────────────────────────────");

test("updateAttributeCommand: rename field, reflected in emit", () => {
  resetUndo();
  const schema = { type: "record", name: "T", fields: [{ name: "old", type: "string" }] };
  const p = buildProjection(schema);
  const record = getRecord(p);
  const fieldId = record.children[0];

  executeCommand(updateAttributeCommand(
    { nodeId: fieldId, scope: "native", key: "name", newValue: "new" },
    p, () => rebuildPaths(p)
  ));

  assertEqual(generateAvroFromProjection(p).fields[0].name, "new");
  undo();
  assertEqual(generateAvroFromProjection(p).fields[0].name, "old");
});

test("updateAttributeCommand: add and remove custom attribute", () => {
  resetUndo();
  const schema = { type: "record", name: "T", fields: [{ name: "a", type: "string" }] };
  const p = buildProjection(schema);
  const record = getRecord(p);
  const fieldId = record.children[0];

  // Add custom attribute
  executeCommand(updateAttributeCommand(
    { nodeId: fieldId, scope: "custom", key: "x-doc", newValue: "important" },
    p, () => rebuildPaths(p)
  ));
  assertEqual(p.nodes.get(fieldId).attributes.custom["x-doc"], "important");

  // Remove it (set to undefined triggers delete on undo path)
  undo();
  assertEqual(p.nodes.get(fieldId).attributes.custom["x-doc"], undefined);
});

test("updateAttributeCommand: custom attr in native survives emit", () => {
  resetUndo();
  // Schema with a pre-existing custom attribute
  const schema = { type: "record", name: "T", "x-source": "legacy", fields: [
    { name: "a", type: "string", "x-deprecated": true }
  ]};
  const p = buildProjection(schema);

  // Verify custom attrs are in native
  const record = getRecord(p);
  assertEqual(record.attributes.native["x-source"], "legacy");
  const fieldId = record.children[0];
  assertEqual(p.nodes.get(fieldId).attributes.native["x-deprecated"], true);

  // Add new custom attr to native (as the detail panel now does)
  executeCommand(updateAttributeCommand(
    { nodeId: fieldId, scope: "native", key: "x-owner", newValue: "team-a" },
    p, () => rebuildPaths(p)
  ));

  // Emit and verify both original and new custom attrs are in output
  const emitted = generateAvroFromProjection(p);
  assertEqual(emitted["x-source"], "legacy");
  assertEqual(emitted.fields[0]["x-deprecated"], true);
  assertEqual(emitted.fields[0]["x-owner"], "team-a");

  // Undo removes the added attr
  undo();
  const emitted2 = generateAvroFromProjection(p);
  assertEqual(emitted2.fields[0]["x-owner"], undefined);
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS — Projection Integrity
// ═══════════════════════════════════════════════════════════════════════════════

console.log("\n── rebuildPaths ────────────────────────────────────────────");

test("rebuildPaths: correct after mutation", () => {
  const schema = { type: "record", name: "T", fields: [
    { name: "a", type: "string" },
    { name: "b", type: ["null", "int"] },
  ]};
  const p = buildProjection(schema);
  rebuildPaths(p);

  const record = getRecord(p);
  const fieldA = p.nodes.get(record.children[0]);
  assertEqual(fieldA.path, ["fields", 0]);
  const typeA = p.nodes.get(fieldA.children[0]);
  assertEqual(typeA.path, ["fields", 0, "type"]);

  const fieldB = p.nodes.get(record.children[1]);
  assertEqual(fieldB.path, ["fields", 1]);
  const unionB = p.nodes.get(fieldB.children[0]);
  assertEqual(unionB.path, ["fields", 1, "type"]);

  // Union branches
  const branch0 = p.nodes.get(unionB.children[0]);
  assertEqual(branch0.path, ["fields", 1, "type", 0]);
  const branch1 = p.nodes.get(unionB.children[1]);
  assertEqual(branch1.path, ["fields", 1, "type", 1]);
});

console.log("\n── Multi-step undo ─────────────────────────────────────────");

test("multi-step undo: 3 operations then undo all", () => {
  resetUndo();
  const schema = { type: "record", name: "T", fields: [
    { name: "a", type: "string" },
    { name: "b", type: "int" },
    { name: "c", type: "long" },
  ]};
  const p = buildProjection(schema);
  const record = getRecord(p);

  // Op 1: rename "a" → "x"
  executeCommand(updateAttributeCommand(
    { nodeId: record.children[0], scope: "native", key: "name", newValue: "x" },
    p, () => rebuildPaths(p)
  ));
  // Op 2: remove "b"
  executeCommand(removeNodeCommand(
    { nodeId: record.children[1] }, p, () => rebuildPaths(p)
  ));
  // Op 3: rename "c" → "z"
  executeCommand(updateAttributeCommand(
    { nodeId: record.children[1], scope: "native", key: "name", newValue: "z" },
    p, () => rebuildPaths(p)
  ));

  let emitted = generateAvroFromProjection(p);
  assertEqual(emitted.fields.length, 2);
  assertEqual(emitted.fields[0].name, "x");
  assertEqual(emitted.fields[1].name, "z");

  // Undo all 3
  undo(); undo(); undo();
  emitted = generateAvroFromProjection(p);
  assertEqual(emitted.fields.length, 3);
  assertEqual(emitted.fields[0].name, "a");
  assertEqual(emitted.fields[1].name, "b");
  assertEqual(emitted.fields[2].name, "c");
});

console.log("\n── cloneSubtree ────────────────────────────────────────────");

test("cloneSubtree: deep clone preserves structure, assigns new IDs", () => {
  const schema = { type: "record", name: "T", fields: [
    { name: "nested", type: {
      type: "record", name: "Inner",
      fields: [{ name: "x", type: ["null", "int"] }]
    }}
  ]};
  const p = buildProjection(schema);
  const record = getRecord(p);
  const fieldId = record.children[0];
  const field = p.nodes.get(fieldId);

  const clone = cloneSubtree(field, p);

  // Verify root is a field
  assertEqual(clone.root.kind, "field");
  // Verify all nodes have unique IDs (not same as originals)
  const originalIds = new Set([...p.nodes.keys()]);
  for (const cloned of clone.nodes) {
    assert(!originalIds.has(cloned.id), `Clone ID ${cloned.id} collides with original`);
  }
  // Verify structure depth: field → record → field → union → 2 branches
  assert(clone.nodes.length >= 5, `Expected at least 5 cloned nodes, got ${clone.nodes.length}`);
  // Verify parent-child links are internal to clone
  for (const cloned of clone.nodes) {
    if (cloned.parentId) {
      const parent = clone.nodes.find(n => n.id === cloned.parentId);
      assert(parent, `Parent ${cloned.parentId} of cloned node ${cloned.id} not found in clone set`);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS — Search Engine
// ═══════════════════════════════════════════════════════════════════════════════

console.log("\n── queryNodes ──────────────────────────────────────────────");

test("queryNodes: search by field name (fuzzy)", () => {
  const schema = {
    type: "record", name: "User", namespace: "com.example",
    fields: [
      { name: "firstName", type: "string" },
      { name: "lastName", type: "string" },
      { name: "email", type: "string" },
      { name: "age", type: "int" },
    ]
  };
  const p = buildProjection(schema);
  const results = queryNodes(p, { name: "first" });

  assert(results.length >= 1, "Should find at least 1 result");
  assertEqual(results[0].node.attributes.native.name, "firstName");
});

test("queryNodes: search by type", () => {
  const schema = {
    type: "record", name: "T",
    fields: [
      { name: "a", type: "string" },
      { name: "b", type: "int" },
      { name: "c", type: { type: "array", items: "string" } },
    ]
  };
  const p = buildProjection(schema);
  const results = queryNodes(p, { type: "array" });

  assert(results.length >= 1, "Should find array field");
  // The field 'c' should appear since its type is array
  const fieldC = results.find(r => r.node.kind === "field" && r.node.attributes.native.name === "c");
  assert(fieldC, "Field 'c' with array type should match");
});

test("queryNodes: search by parent record and namespace", () => {
  const schema = {
    type: "record", name: "Outer", namespace: "com.test",
    fields: [
      { name: "x", type: "string" },
      { name: "inner", type: { type: "record", name: "Inner", namespace: "com.test", fields: [
        { name: "y", type: "int" }
      ]}}
    ]
  };
  const p = buildProjection(schema);

  // Search by parent
  const byParent = queryNodes(p, { parent: "Inner" });
  assert(byParent.length >= 1, "Should find nodes under Inner");
  const fieldY = byParent.find(r => r.node.kind === "field" && r.node.attributes.native.name === "y");
  assert(fieldY, "Field 'y' should match parent=Inner");

  // Search by namespace
  const byNs = queryNodes(p, { namespace: "com.test" });
  assert(byNs.length >= 1, "Should find nodes with com.test namespace");
});

test("queryNodes: excludes primitive nodes from results", () => {
  const schema = {
    type: "record", name: "T",
    fields: [
      { name: "name", type: "string" },
      { name: "opt", type: ["null", "string"] },
    ]
  };
  const p = buildProjection(schema);

  // Free-text search for "string" — should find fields, NOT primitive nodes
  const results = queryNodes(p, { text: "string" });
  for (const r of results) {
    assert(r.node.kind !== "primitive", "Primitives should be excluded: found " + r.node.kind);
    assert(r.node.kind !== "named", "Named refs should be excluded");
  }
  // Should find at least the field "name" (type: string)
  const fieldName = results.find(r => r.node.kind === "field" && r.node.attributes.native.name === "name");
  assert(fieldName, "Field 'name' with type string should match free-text 'string'");
});

test("queryNodes: type search finds logical types (date, decimal)", () => {
  const schema = {
    type: "record", name: "T",
    fields: [
      { name: "createdAt", type: { type: "int", logicalType: "date" } },
      { name: "amount", type: { type: "bytes", logicalType: "decimal", precision: 10, scale: 2 } },
      { name: "plainInt", type: "int" },
    ]
  };
  const p = buildProjection(schema);

  // Search t:date should find createdAt
  const dateResults = queryNodes(p, { type: "date" });
  assert(dateResults.length >= 1, "Should find field with date logical type");
  const dateField = dateResults.find(r => r.node.attributes.native.name === "createdAt");
  assert(dateField, "createdAt should match t:date");

  // Search t:decimal should find amount
  const decResults = queryNodes(p, { type: "decimal" });
  assert(decResults.length >= 1, "Should find field with decimal logical type");
  const decField = decResults.find(r => r.node.attributes.native.name === "amount");
  assert(decField, "amount should match t:decimal");

  // Search t:int should find plainInt AND createdAt (base type is still int)
  const intResults = queryNodes(p, { type: "int" });
  const plainField = intResults.find(r => r.node.attributes.native.name === "plainInt");
  assert(plainField, "plainInt should match t:int");
  const dateInInt = intResults.find(r => r.node.attributes.native.name === "createdAt");
  assert(dateInInt, "createdAt should match t:int (base type is int)");
});

test("queryNodes: type search matches union branches", () => {
  const schema = {
    type: "record", name: "T",
    fields: [
      { name: "opt", type: ["null", "string"] },
      { name: "multi", type: ["null", "int", "string"] },
      { name: "plain", type: "boolean" },
    ]
  };
  const p = buildProjection(schema);

  // t:string should find opt and multi (unions containing string)
  const strResults = queryNodes(p, { type: "string" });
  const optField = strResults.find(r => r.node.attributes.native.name === "opt");
  assert(optField, "opt (union with string) should match t:string");
  const multiField = strResults.find(r => r.node.attributes.native.name === "multi");
  assert(multiField, "multi (union with string) should match t:string");

  // t:union should still work
  const unionResults = queryNodes(p, { type: "union" });
  assert(unionResults.length >= 2, "t:union should find union fields");

  // t:boolean should find plain but not the union fields
  const boolResults = queryNodes(p, { type: "boolean" });
  const plainField = boolResults.find(r => r.node.attributes.native.name === "plain");
  assert(plainField, "plain should match t:boolean");
  const optInBool = boolResults.find(r => r.node.attributes.native.name === "opt");
  assert(!optInBool, "opt should NOT match t:boolean");
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS — replaceType + buildTypeSubtree
// ═══════════════════════════════════════════════════════════════════════════════

console.log("\n── replaceTypeCommand ──────────────────────────────────────");

test("replaceTypeCommand: field type string → int", () => {
  resetUndo();
  const schema = { type: "record", name: "T", fields: [{ name: "a", type: "string" }] };
  const p = buildProjection(schema);
  const record = getRecord(p);
  const fieldId = record.children[0];

  executeCommand(replaceTypeCommand(
    { parentNodeId: fieldId, newTypeSpec: "int" },
    p, () => rebuildPaths(p)
  ));

  const emitted = generateAvroFromProjection(p);
  assertEqual(emitted.fields[0].type, "int");

  undo();
  assertEqual(generateAvroFromProjection(p).fields[0].type, "string");
});

test("replaceTypeCommand: field type primitive → union", () => {
  resetUndo();
  const schema = { type: "record", name: "T", fields: [{ name: "a", type: "string" }] };
  const p = buildProjection(schema);
  const record = getRecord(p);
  const fieldId = record.children[0];

  executeCommand(replaceTypeCommand(
    { parentNodeId: fieldId, newTypeSpec: ["null", "string", "int"] },
    p, () => rebuildPaths(p)
  ));

  const emitted = generateAvroFromProjection(p);
  assert(Array.isArray(emitted.fields[0].type), "Should be union array");
  assertEqual(emitted.fields[0].type.length, 3);
  assertEqual(emitted.fields[0].type[0], "null");

  undo();
  assertEqual(generateAvroFromProjection(p).fields[0].type, "string");
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS — Guards + Validation
// ═══════════════════════════════════════════════════════════════════════════════

console.log("\n── Action guards ───────────────────────────────────────────");

test("guard: cannot remove a field's type child", () => {
  const schema = { type: "record", name: "T", fields: [{ name: "a", type: "string" }] };
  const p = buildProjection(schema);
  const record = getRecord(p);
  const field = p.nodes.get(record.children[0]);
  const typeId = field.children[0];

  let threw = false;
  try {
    removeNodeCommand({ nodeId: typeId }, p, () => {});
  } catch (e) {
    threw = true;
    assert(e.message.includes("Cannot remove"), "Error should mention cannot remove");
  }
  assert(threw, "Should throw when removing single-slot type child");
});

console.log("\n── buildTypeSubtree ────────────────────────────────────────");

test("buildTypeSubtree: creates correct structure for complex types", () => {
  // Union with nested record
  const subtree = buildTypeSubtree(["null", { type: "record", name: "Nested", fields: [{ name: "x", type: "int" }] }]);

  assertEqual(subtree.root.kind, "union");
  assert(subtree.nodes.length >= 4, `Expected >=4 nodes, got ${subtree.nodes.length}`);

  // Find the record node in the subtree
  const recordNode = subtree.nodes.find(n => n.kind === "record");
  assert(recordNode, "Should contain a record node");
  assertEqual(recordNode.attributes.native.name, "Nested");

  // Find the field node
  const fieldNode = subtree.nodes.find(n => n.kind === "field");
  assert(fieldNode, "Should contain a field node");
  assertEqual(fieldNode.attributes.native.name, "x");
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS — Missing Action Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

console.log("\n── moveNodeCommand guards ──────────────────────────────────");

test("guard: cannot move a field's type child", () => {
  const schema = { type: "record", name: "T", fields: [
    { name: "a", type: "string" },
    { name: "b", type: "int" },
  ]};
  const p = buildProjection(schema);
  const record = getRecord(p);
  const field = p.nodes.get(record.children[0]);
  const typeId = field.children[0];

  let threw = false;
  try {
    moveNodeCommand(
      { nodeId: typeId, targetNodeId: record.id, slot: SLOT.RECORD_FIELDS },
      p, () => {}
    );
  } catch (e) {
    threw = true;
    assert(e.message.includes("Cannot move"), "Error should mention cannot move");
  }
  assert(threw, "Should throw when moving single-slot type child");
});

console.log("\n── copyNodeCommand guards ──────────────────────────────────");

test("guard: cannot copy a type node", () => {
  const schema = { type: "record", name: "T", fields: [{ name: "a", type: "string" }] };
  const p = buildProjection(schema);
  const record = getRecord(p);
  const field = p.nodes.get(record.children[0]);
  const typeId = field.children[0];

  let threw = false;
  try {
    copyNodeCommand(
      { sourceNodeId: typeId, targetNodeId: record.id, slot: SLOT.RECORD_FIELDS },
      p, () => {}
    );
  } catch (e) {
    threw = true;
    assert(e.message.includes("Cannot copy a type node"), "Error should mention cannot copy type");
  }
  assert(threw, "Should throw when copying a type node");
});

console.log("\n── replaceTypeCommand: array/map + guards ──────────────────");

test("replaceTypeCommand: array items string → int", () => {
  resetUndo();
  const schema = { type: "record", name: "T", fields: [
    { name: "tags", type: { type: "array", items: "string" } }
  ]};
  const p = buildProjection(schema);
  const record = getRecord(p);
  const field = p.nodes.get(record.children[0]);
  const arrayNode = p.nodes.get(field.children[0]);

  executeCommand(replaceTypeCommand(
    { parentNodeId: arrayNode.id, newTypeSpec: "int" },
    p, () => rebuildPaths(p)
  ));

  const emitted = generateAvroFromProjection(p);
  assertEqual(emitted.fields[0].type.items, "int");

  undo();
  assertEqual(generateAvroFromProjection(p).fields[0].type.items, "string");
});

test("replaceTypeCommand: map values string → long", () => {
  resetUndo();
  const schema = { type: "record", name: "T", fields: [
    { name: "meta", type: { type: "map", values: "string" } }
  ]};
  const p = buildProjection(schema);
  const record = getRecord(p);
  const field = p.nodes.get(record.children[0]);
  const mapNode = p.nodes.get(field.children[0]);

  executeCommand(replaceTypeCommand(
    { parentNodeId: mapNode.id, newTypeSpec: "long" },
    p, () => rebuildPaths(p)
  ));

  const emitted = generateAvroFromProjection(p);
  assertEqual(emitted.fields[0].type.values, "long");

  undo();
  assertEqual(generateAvroFromProjection(p).fields[0].type.values, "string");
});

test("guard: replaceTypeCommand rejects invalid parent (record)", () => {
  const schema = { type: "record", name: "T", fields: [{ name: "a", type: "string" }] };
  const p = buildProjection(schema);
  const record = getRecord(p);

  let threw = false;
  try {
    replaceTypeCommand(
      { parentNodeId: record.id, newTypeSpec: "int" },
      p, () => {}
    );
  } catch (e) {
    threw = true;
    assert(e.message.includes("only works on field/array/map"), "Should reject non-field/array/map");
  }
  assert(threw, "Should throw for invalid parent kind");
});

console.log("\n── createNodeCommand: index insertion ──────────────────────");

test("createNodeCommand: insert field at specific index", () => {
  resetUndo();
  const schema = { type: "record", name: "T", fields: [
    { name: "a", type: "string" },
    { name: "c", type: "long" },
  ]};
  const p = buildProjection(schema);
  const record = getRecord(p);

  const newField = buildFieldSubtree({ name: "b", type: "int" });

  executeCommand(createNodeCommand(
    { newSubtree: newField, targetNodeId: record.id, slot: SLOT.RECORD_FIELDS, index: 1 },
    p, () => rebuildPaths(p)
  ));

  const emitted = generateAvroFromProjection(p);
  assertEqual(emitted.fields.length, 3);
  assertEqual(emitted.fields[0].name, "a");
  assertEqual(emitted.fields[1].name, "b");
  assertEqual(emitted.fields[2].name, "c");

  undo();
  assertEqual(generateAvroFromProjection(p).fields.length, 2);
});

console.log("\n── getValidMoveTargets ─────────────────────────────────────");

test("getValidMoveTargets: returns valid destinations for a field", () => {
  const schema = {
    type: "record", name: "Outer", fields: [
      { name: "a", type: "string" },
      { name: "inner", type: { type: "record", name: "Inner", fields: [{ name: "x", type: "int" }] } },
    ]
  };
  const p = buildProjection(schema);
  const outerRecord = getRecord(p);
  const fieldAId = outerRecord.children[0];

  const targets = getValidMoveTargets(fieldAId, p);

  // Should include Inner record as a valid target
  let innerRecord = null;
  for (const n of p.nodes.values()) {
    if (n.kind === "record" && n.attributes.native.name === "Inner") { innerRecord = n; break; }
  }
  assert(innerRecord, "Inner record should exist");

  const hasInner = targets.some(t => t.targetNodeId === innerRecord.id);
  assert(hasInner, "Inner record should be a valid move target");

  // Should NOT include field's own type child as target
  const field = p.nodes.get(fieldAId);
  const typeChild = field.children[0];
  const hasOwnType = targets.some(t => t.targetNodeId === typeChild);
  assert(!hasOwnType, "Field's own type child should not be a move target");
});

test("getValidMoveTargets: returns empty for single-slot type child", () => {
  const schema = { type: "record", name: "T", fields: [{ name: "a", type: "string" }] };
  const p = buildProjection(schema);
  const record = getRecord(p);
  const field = p.nodes.get(record.children[0]);
  const typeId = field.children[0];

  const targets = getValidMoveTargets(typeId, p);
  assertEqual(targets.length, 0, "Single-slot type nodes should have no valid move targets");
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS — Render Engine (flattenVisibleNodes, expand/collapse)
// ═══════════════════════════════════════════════════════════════════════════════

console.log("\n── flattenVisibleNodes ─────────────────────────────────────");

test("flattenVisibleNodes: root expanded shows record + children", () => {
  const schema = {
    type: "record", name: "User",
    fields: [
      { name: "id", type: "string" },
      { name: "age", type: "int" },
      { name: "email", type: "string" },
    ]
  };
  const p = buildProjection(schema);
  const record = getRecord(p);

  // Expand root record
  const expanded = new Set([record.id]);
  const flat = flattenVisibleNodes(p, expanded);

  // Should have: record, id(field), id-type(prim), age(field), age-type(prim), email(field), email-type(prim)
  // Actually fields are children of record, and type nodes are children of field
  // record is root type node; expanded shows its children (fields)
  // Each field has a type child which is not expandable, so it appears as a row

  // Record + 3 fields + 3 type children = 7
  assert(flat.length >= 4, `Expected >=4 visible nodes, got ${flat.length}`);
  // First node is the record itself
  assertEqual(flat[0].id, record.id);
  assertEqual(flat[0].depth, 0);
  // Record's children (fields) should be at depth 1
  assertEqual(flat[1].depth, 1);
});

test("flattenVisibleNodes: collapsed root shows only root", () => {
  const schema = {
    type: "record", name: "T",
    fields: [
      { name: "a", type: "string" },
      { name: "b", type: "int" },
    ]
  };
  const p = buildProjection(schema);

  // Empty expanded set = root collapsed
  const flat = flattenVisibleNodes(p, new Set());

  // Only the root record should be visible
  assertEqual(flat.length, 1);
  assertEqual(flat[0].depth, 0);
});

test("flattenVisibleNodes: nested records respect expand state", () => {
  const schema = {
    type: "record", name: "Outer",
    fields: [
      { name: "x", type: "string" },
      { name: "inner", type: {
        type: "record", name: "Inner",
        fields: [
          { name: "y", type: "int" },
          { name: "z", type: "long" }
        ]
      }}
    ]
  };
  const p = buildProjection(schema);
  const outerRecord = getRecord(p);

  // Expand only outer record — fields visible but inner record's fields hidden
  const expandedOuter = new Set([outerRecord.id]);
  const flatOuter = flattenVisibleNodes(p, expandedOuter);
  const outerLen = flatOuter.length;

  // Now also expand the "inner" field to reveal the nested record's fields
  const innerFieldId = outerRecord.children[1];
  const expandedBoth = new Set([outerRecord.id, innerFieldId]);
  const flatBoth = flattenVisibleNodes(p, expandedBoth);

  // Should have more nodes visible (inner record's fields)
  assert(flatBoth.length > outerLen, "Expanding inner field should reveal more nodes");
});

test("flattenVisibleNodes: union branches visible when field expanded", () => {
  const schema = {
    type: "record", name: "T",
    fields: [
      { name: "opt", type: ["null", "string", "int"] }
    ]
  };
  const p = buildProjection(schema);
  const record = getRecord(p);
  const fieldId = record.children[0];

  // Expand record + field → field expansion shows union branches directly
  const expanded = new Set([record.id, fieldId]);
  const flat = flattenVisibleNodes(p, expanded);

  // Should show: record, field, null, string, int = 5
  assert(flat.length >= 5, `Expected >=5 nodes with expanded field (union), got ${flat.length}`);
});

console.log("\n── typeBadgeText ───────────────────────────────────────────");

test("typeBadgeText: primitive types", () => {
  const p = buildProjection({ type: "record", name: "T", fields: [{ name: "a", type: "string" }] });
  const record = getRecord(p);
  const field = p.nodes.get(record.children[0]);
  const typeNode = p.nodes.get(field.children[0]);

  const text = typeBadgeText(typeNode, p);
  assertEqual(text, "string");
});

test("typeBadgeText: union shows compact inline format", () => {
  const p = buildProjection({ type: "record", name: "T", fields: [{ name: "a", type: ["null", "string"] }] });
  const record = getRecord(p);
  const field = p.nodes.get(record.children[0]);
  const unionNode = p.nodes.get(field.children[0]);

  const text = typeBadgeText(unionNode, p);
  assertEqual(text, "[null, string]");
});

test("typeBadgeText: array shows array<T> format", () => {
  const p = buildProjection({ type: "record", name: "T", fields: [{ name: "a", type: { type: "array", items: "int" } }] });
  const record = getRecord(p);
  const field = p.nodes.get(record.children[0]);
  const arrayNode = p.nodes.get(field.children[0]);

  const text = typeBadgeText(arrayNode, p);
  assertEqual(text, "array<int>");
});

test("typeBadgeText: map shows map<T> format", () => {
  const p = buildProjection({ type: "record", name: "T", fields: [{ name: "a", type: { type: "map", values: "string" } }] });
  const record = getRecord(p);
  const field = p.nodes.get(record.children[0]);
  const mapNode = p.nodes.get(field.children[0]);

  const text = typeBadgeText(mapNode, p);
  assertEqual(text, "map<string>");
});

test("unionBadgeText: truncates long unions", () => {
  const p = buildProjection({ type: "record", name: "T", fields: [
    { name: "a", type: ["null", "string", "int", "long"] }
  ]});
  const record = getRecord(p);
  const field = p.nodes.get(record.children[0]);
  const unionNode = p.nodes.get(field.children[0]);

  const text = unionBadgeText(unionNode, p);
  // Should truncate after 2 and show count
  assertEqual(text, "[null, string, +2]");
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS — Search UI (parseSearchInput, ensureNodeVisible)
// ═══════════════════════════════════════════════════════════════════════════════

console.log("\n── parseSearchInput ────────────────────────────────────────");

test("parseSearchInput: plain text → name filter (default)", () => {
  const result = parseSearchInput("user");
  assertEqual(result, { name: "user" });
});

test("parseSearchInput: prefix g: → free-text filter", () => {
  const result = parseSearchInput("g:user");
  assertEqual(result, { text: "user" });
});

test("parseSearchInput: prefix n: → name filter", () => {
  const result = parseSearchInput("n:email");
  assertEqual(result, { name: "email" });
});

test("parseSearchInput: prefix t: → type filter", () => {
  const result = parseSearchInput("t:string");
  assertEqual(result, { type: "string" });
});

test("parseSearchInput: prefix p: → parent filter", () => {
  const result = parseSearchInput("p:User");
  assertEqual(result, { parent: "User" });
});

test("parseSearchInput: prefix ns: → namespace filter", () => {
  const result = parseSearchInput("ns:com.example");
  assertEqual(result, { namespace: "com.example" });
});

test("parseSearchInput: empty/null input returns null", () => {
  assertEqual(parseSearchInput(""), null);
  assertEqual(parseSearchInput("   "), null);
  assertEqual(parseSearchInput(null), null);
});

test("parseSearchInput: prefix with no value returns null", () => {
  assertEqual(parseSearchInput("n:"), null);
  assertEqual(parseSearchInput("t:  "), null);
  assertEqual(parseSearchInput("g:"), null);
});

console.log("\n── ensureNodeVisible ───────────────────────────────────────");

test("ensureNodeVisible: expands ancestors to reveal deeply nested node", () => {
  const schema = {
    type: "record", name: "Outer",
    fields: [{
      name: "inner", type: {
        type: "record", name: "Inner",
        fields: [{ name: "deep", type: "string" }]
      }
    }]
  };
  const p = buildProjection(schema);
  expandedNodeIds = new Set();

  // Find the deeply nested field "deep"
  let deepField = null;
  for (const [id, node] of p.nodes) {
    if (node.kind === "field" && node.attributes.native.name === "deep") {
      deepField = node;
      break;
    }
  }
  assert(deepField, "Should find deep field");

  ensureNodeVisible(deepField.id, p);

  // After ensuring visibility, ancestors should be expanded
  assert(expandedNodeIds.size > 0, "Should have expanded some ancestors");

  // Now flatten — the deep node should appear
  const flat = flattenVisibleNodes(p, expandedNodeIds);
  const hasDeep = flat.some(n => n.id === deepField.id);
  assert(hasDeep, "Deep field should be visible after ensureNodeVisible");
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log("\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
console.log(`  ${passed} passed, ${failed} failed (${sampleFiles.length} samples used in roundtrip)`);
if (failures.length) {
  console.log("\n  Failures:");
  failures.forEach((f) => console.log(`    \u2717 ${f.name}: ${f.error.split("\n")[0]}`));
}
console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n");

process.exit(failed > 0 ? 1 : 0);
