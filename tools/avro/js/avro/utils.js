/* ============================
   Constants
============================ */

const COMPLEX_TYPES = ["record", "array", "map", "enum", "fixed", "union"];
const PRIMITIVE_TYPES = [
  "null",
  "boolean",
  "int",
  "long",
  "float",
  "double",
  "bytes",
  "string",
];

const LOGICAL_TYPES = {
  int: ["", "date", "time-millis"],
  long: [
    "",
    "timestamp-millis",
    "timestamp-micros",
    "timestamp-nanos",
    "local-timestamp-millis",
    "local-timestamp-micros",
    "local-timestamp-nanos",
    "time-micros",
  ],
  bytes: ["", "decimal", "big-decimal"],
  fixed: ["", "decimal", "duration", "uuid"],
  string: ["", "uuid"],
};
const LOGICAL_TYPES_ATTRS = {
  decimal: { scale: 0, precision: 0 },
};

// Default Avro specs for creating new type nodes from a selection name.
// Primitives that can have logical types are initialized as objects to enable
// the logical type selector in the detail panel.
const TYPE_TEMPLATES = {
  union: ["null"],
  array: { type: "array", items: "string" },
  map: { type: "map", values: "string" },
  record: { type: "record", name: "NewRecord", namespace: "", fields: [] },
  enum: { type: "enum", symbols: [] },
  fixed: { type: "fixed", name: "NewFixed", size: 1 },
  int: { type: "int" },
  long: { type: "long" },
  bytes: { type: "bytes" },
  string: { type: "string" },
};
const ALLOWED_CHILDREN = {
  schema: ["record"],
  record: ["field"],
  field: [
    "primitive",
    "named",
    "record",
    "enum",
    "fixed",
    "union",
    "array",
    "map",
  ],
  array: [
    "primitive",
    "named",
    "record",
    "enum",
    "fixed",
    "union",
    "array",
    "map",
  ],
  map: [
    "primitive",
    "named",
    "record",
    "enum",
    "fixed",
    "union",
    "array",
    "map",
  ],
  union: ["primitive", "named", "record", "enum", "fixed", "array", "map"],
};

// Slot identifiers (grammar-level)
const SLOT = {
  SCHEMA_ROOT: "schemaRoot",
  RECORD_FIELDS: "record.fields",
  FIELD_TYPE: "field.type",
  ARRAY_ITEMS: "array.items",
  MAP_VALUES: "map.values",
  UNION_BRANCH: "union.branch",
};

// Standard Avro keys per node kind (anything else is a "custom" attribute)
const STANDARD_NATIVE_KEYS = {
  field: new Set(["name", "type", "doc", "default", "order", "aliases"]),
  record: new Set(["type", "name", "namespace", "doc", "fields", "aliases"]),
  enum: new Set([
    "type",
    "name",
    "namespace",
    "doc",
    "symbols",
    "default",
    "aliases",
  ]),
  fixed: new Set(["type", "name", "namespace", "size", "doc", "aliases"]),
  primitive: new Set(["type", "logicalType", "precision", "scale"]),
  named: new Set([]),
  union: new Set([]),
  array: new Set(["type", "items", "default"]),
  map: new Set(["type", "values", "default"]),
  schema: new Set(["type", "name", "namespace", "doc", "fields", "aliases"]),
};

const SLOT_ACCEPTS = {
  [SLOT.SCHEMA_ROOT]: [
    "record",
    "enum",
    "fixed",
    "array",
    "map",
    "union",
    "primitive",
    "named",
  ],

  [SLOT.RECORD_FIELDS]: ["field"],

  [SLOT.FIELD_TYPE]: [
    "record",
    "enum",
    "fixed",
    "array",
    "map",
    "union",
    "primitive",
    "named",
  ],

  [SLOT.ARRAY_ITEMS]: [
    "record",
    "enum",
    "fixed",
    "array",
    "map",
    "union",
    "primitive",
    "named",
  ],

  [SLOT.MAP_VALUES]: [
    "record",
    "enum",
    "fixed",
    "array",
    "map",
    "union",
    "primitive",
    "named",
  ],

  [SLOT.UNION_BRANCH]: [
    "record",
    "enum",
    "fixed",
    "array",
    "map",
    "primitive",
    "named",
  ],
};
/* ============================
   PROJECTION HELPERS
============================ */

function newNodeId() {
  return "n" + ++__nodeIdCounter;
}

function createEmptyProjection() {
  return {
    rootId: null,
    nodes: new Map(),
  };
}

function createProjectionNode({ kind, avro, parentId, path, parent }) {
  return {
    id: newNodeId(),
    kind,
    parentId,
    children: [],
    path,
    attributes: {
      native: avro,
      custom: {
        __id: generateNodeId(),
      },
    },
  };
}

function generateNodeId() {
  return crypto.randomUUID();
}

function canAcceptChild(parentKind, childKind) {
  return ALLOWED_CHILDREN[parentKind]?.includes(childKind);
}

function isDescendant(projection, ancestorId, candidateId) {
  let current = projection.nodes.get(candidateId);
  while (current && current.parentId) {
    if (current.parentId === ancestorId) return true;
    current = projection.nodes.get(current.parentId);
  }
  return false;
}

/**
 * Collect all user-defined named types (record, enum, fixed) from the projection.
 * Returns a sorted, deduplicated array of full type names (namespace.name or just name).
 */
function getNamedTypes(projection) {
  const names = new Set();
  for (const node of projection.nodes.values()) {
    if (node.kind === "record" || node.kind === "enum" || node.kind === "fixed") {
      const native = node.attributes.native;
      if (!native || !native.name) continue;
      const fullName = native.namespace
        ? native.namespace + "." + native.name
        : native.name;
      names.add(fullName);
    }
  }
  return [...names].sort();
}

function getSlotsForNode(node) {
  switch (node.kind) {
    case "schema":
      return [{ slot: SLOT.SCHEMA_ROOT, multiple: false }];

    case "record":
      return [{ slot: SLOT.RECORD_FIELDS, multiple: true }];

    case "field":
      return [{ slot: SLOT.FIELD_TYPE, multiple: false }];

    case "array":
      return [{ slot: SLOT.ARRAY_ITEMS, multiple: false }];

    case "map":
      return [{ slot: SLOT.MAP_VALUES, multiple: false }];

    case "union":
      return [{ slot: SLOT.UNION_BRANCH, multiple: true }];

    default:
      return [];
  }
}

function getNodeAvroRole(node) {
  return node.kind;
}

function canInsertIntoSlot({ slot, node }) {
  const role = getNodeAvroRole(node);
  return SLOT_ACCEPTS[slot]?.includes(role);
}

function getSlotChildren(targetNode, slot) {
  switch (slot) {
    case "schemaRoot":
    case "record.fields":
    case "union.branch":
      return targetNode.children;

    case "field.type":
    case "array.items":
    case "map.values":
      return targetNode.children; // single-item list

    default:
      throw new Error(`Unknown slot: ${slot}`);
  }
}

// A node is a type node iff its parent places it in a type slot.
function isTypeNode(node, projection) {
  if (!node.parentId) return false;

  const parent = projection.nodes.get(node.parentId);
  if (!parent) return false;

  return (
    parent.kind === "field" ||
    parent.kind === "array" ||
    parent.kind === "map" ||
    parent.kind === "union"
  );
}

function collectExistingSubtree(root, projection) {
  const nodes = [];

  function visit(node) {
    nodes.push(node);
    for (const childId of node.children) {
      const child = projection.nodes.get(childId);
      if (!child) {
        throw new Error(`Missing child ${childId} in subtree`);
      }
      visit(child);
    }
  }

  visit(root);
  return nodes;
}

function cloneAttributes(attributes) {
  return {
    native: structuredClone(attributes.native),
    custom: {
      ...structuredClone(attributes.custom),
      __id: crypto.randomUUID(),
    },
  };
}

/**
 * Build a type subtree from an Avro type specification.
 * Returns { root, nodes } suitable for createNodeCommand.
 *
 * @param {*} typeSpec - Avro type: "string", ["null","int"], {type:"record",...}, etc.
 * @param {string|null} parentId - Optional parent ID for the root node
 * @returns {{root: Object, nodes: Array<Object>}}
 */
function buildTypeSubtree(typeSpec, parentId = null) {
  const nodes = [];

  function visit(spec, pid) {
    const normalized = normalizeType(spec);
    const node = {
      id: newNodeId(),
      kind: normalized.kind,
      parentId: pid,
      children: [],
      path: [],
      attributes: {
        native: spec,
        custom: { __id: crypto.randomUUID() },
      },
    };
    nodes.push(node);

    if (normalized.kind === "record" && normalized.fields) {
      for (const field of normalized.fields) {
        const fieldNode = {
          id: newNodeId(),
          kind: "field",
          parentId: node.id,
          children: [],
          path: [],
          attributes: {
            native: field,
            custom: { __id: crypto.randomUUID() },
          },
        };
        nodes.push(fieldNode);
        node.children.push(fieldNode.id);
        const typeChild = visit(field.type, fieldNode.id);
        fieldNode.children.push(typeChild.id);
      }
    }

    if (normalized.kind === "array") {
      const itemsChild = visit(normalized.items, node.id);
      node.children.push(itemsChild.id);
    }

    if (normalized.kind === "map") {
      const valuesChild = visit(normalized.values, node.id);
      node.children.push(valuesChild.id);
    }

    if (normalized.kind === "union") {
      for (const branch of normalized.branches) {
        const branchChild = visit(branch, node.id);
        node.children.push(branchChild.id);
      }
    }

    return node;
  }

  const root = visit(typeSpec, parentId);
  return { root, nodes };
}

/**
 * Build a complete field subtree from an Avro field spec.
 * Returns { root, nodes } ready for createNodeCommand.
 * @param {{ name: string, type: any, [key: string]: any }} fieldSpec - Avro field object
 * @param {string|null} parentId - optional parent to attach to
 */
function buildFieldSubtree(fieldSpec, parentId = null) {
  const fieldNode = {
    id: newNodeId(),
    kind: "field",
    parentId,
    children: [],
    path: [],
    attributes: {
      native: fieldSpec,
      custom: { __id: crypto.randomUUID() },
    },
  };

  const typeSub = buildTypeSubtree(fieldSpec.type, fieldNode.id);
  fieldNode.children.push(typeSub.root.id);

  return { root: fieldNode, nodes: [fieldNode, ...typeSub.nodes] };
}

/**
 * Check if removing/moving this node would violate single-slot constraints.
 * Returns true if the node is in a slot that requires exactly one child.
 */
function isInSingleSlot(node, projection) {
  if (!node.parentId) return false;
  const parent = projection.nodes.get(node.parentId);
  if (!parent) return false;
  return (
    parent.kind === "field" || parent.kind === "array" || parent.kind === "map"
  );
}
/* ============================
   AVRO HELPERS
============================ */

function isPrimitive(type) {
  return typeof type === "string" && PRIMITIVE_TYPES.includes(type);
}

function isComplexType(type) {
  if (typeof type === "string") return COMPLEX_TYPES.includes(type);
  else return COMPLEX_TYPES.includes(type.kind);
}

function normalizeType(type) {
  // primitive or named reference
  if (typeof type === "string") {
    return {
      kind: PRIMITIVE_TYPES.includes(type) ? "primitive" : "named",
      type,
    };
  }

  // union
  if (Array.isArray(type)) {
    return {
      kind: "union",
      branches: type,
    };
  }

  // complex or logical type
  if (typeof type === "object" && typeof type.type === "string") {
    return {
      kind: PRIMITIVE_TYPES.includes(type.type) ? "primitive" : type.type,
      ...type,
    };
  }

  throw new Error("Invalid Avro type value");
}
