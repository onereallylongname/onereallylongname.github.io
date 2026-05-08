/* ============================
   INITIALIZE VARS
============================ */

let currentProjection;
let __nodeIdCounter = 0;

/* ============================
   PROJECTION CREATION AVRO 
============================ */

function getAvroChildren(avroNode) {
  const normalized = normalizeType(avroNode);

  switch (normalized.kind) {
    case "record":
      return avroNode.fields.map((f) => ({
        kind: "field",
        avro: f,
        key: f.name,
      }));

    case "field":
      return [
        {
          kind: "type",
          avro: avroNode.type,
          key: "type",
        },
      ];

    case "array":
      return [
        {
          kind: "array",
          avro: avroNode.items,
          key: "items",
        },
      ];

    case "map":
      return [
        {
          kind: "map",
          avro: avroNode.values,
          key: "values",
        },
      ];

    case "union":
      return normalized.branches.map((b, i) => ({
        kind: "type",
        avro: b,
        key: i,
      }));

    default:
      return [];
  }
}

function registerNode(projection, node) {
  projection.nodes.set(node.id, node);

  if (node.parentId) {
    const parent = projection.nodes.get(node.parentId);
    if (!parent) {
      throw new Error("Parent node does not exist: " + node.parentId);
    }
    parent.children.push(node.id);
  } else {
    projection.rootId = node.id;
  }

  return node;
}

/** MAIN ENTRY **/
function buildProjection(currentSchema) {
  __nodeIdCounter = 0;
  const projection = createEmptyProjection();

  function visitType(typeValue, parentId, path) {
    const normalized = normalizeType(typeValue);

    const typeNode = createProjectionNode({
      kind: normalized.kind,
      avro: typeValue,
      parentId,
      path,
    });

    registerNode(projection, typeNode);

    if (normalized.kind === "record") {
      normalized.fields.forEach((f, i) => {
        visitField(f, typeNode.id, path.concat("fields", i));
      });
    }

    if (normalized.kind === "array") {
      visitType(normalized.items, typeNode.id, path.concat("items"));
    }

    if (normalized.kind === "map") {
      visitType(normalized.values, typeNode.id, path.concat("values"));
    }

    if (normalized.kind === "union") {
      normalized.branches.forEach((b, i) => {
        visitType(b, typeNode.id, path.concat(i));
      });
    }
  }

  function visitField(field, parentId, path) {
    const fieldNode = createProjectionNode({
      kind: "field",
      avro: field,
      parentId,
      path,
    });

    registerNode(projection, fieldNode);
    visitType(field.type, fieldNode.id, path.concat("type"));
  }

  function visitSchema(schema) {
    const rootNode = createProjectionNode({
      kind: "schema",
      avro: schema,
      parentId: null,
      path: [],
    });

    registerNode(projection, rootNode);
    visitType(schema, rootNode.id, []);
  }

  visitSchema(currentSchema);
  assertProjectionComplete(projection);
  return projection;
}

/* ============================
   PROJECTION CREATION AVRO 
============================ */

/* ENTRY POINT FOR RECUNSTRUCTION */
//If regenerating Avro changes behavior unexpectedly, the projection is incomplete — not the generator.
function generateAvroFromProjection(projection) {
  const rootNode = projection.nodes.get(projection.rootId);
  return emitNode(rootNode, projection);
}

/* The emitter dispatcher */
function emitNode(node, projection) {
  switch (node.kind) {
    case "schema":
      return emitSchema(node, projection);

    case "record":
      return emitRecord(node, projection);

    case "field":
      return emitField(node, projection);

    case "array":
      return emitArray(node, projection);

    case "map":
      return emitMap(node, projection);

    case "union":
      return emitUnion(node, projection);

    case "enum":
      return emitEnum(node);

    case "fixed":
      return emitFixed(node);

    case "primitive":
    case "named":
      return emitPrimitive(node);

    default:
      throw new Error("Unknown node kind: " + node.kind);
  }
}

/* ============================
   PROJECTION UPDATES
============================ */

function rebuildPaths(projection) {
  const root = projection.nodes.get(projection.rootId);
  if (!root) throw new Error("Projection has no root");

  function visit(node, path) {
    node.path = path;

    switch (node.kind) {
      case "schema": {
        // schema has a single type child
        const [childId] = node.children;
        if (childId) {
          visit(projection.nodes.get(childId), path);
        }
        break;
      }

      case "record": {
        node.children.forEach((childId, index) => {
          visit(projection.nodes.get(childId), path.concat("fields", index));
        });
        break;
      }

      case "field": {
        const [typeId] = node.children;
        visit(projection.nodes.get(typeId), path.concat("type"));
        break;
      }

      case "array": {
        const [itemsId] = node.children;
        visit(projection.nodes.get(itemsId), path.concat("items"));
        break;
      }

      case "map": {
        const [valuesId] = node.children;
        visit(projection.nodes.get(valuesId), path.concat("values"));
        break;
      }

      case "union": {
        node.children.forEach((childId, index) => {
          visit(projection.nodes.get(childId), path.concat(index));
        });
        break;
      }

      case "enum":
      case "fixed":
      case "primitive":
      case "named":
        // leaf nodes
        break;

      default:
        throw new Error(`Unknown node kind ${node.kind} in ${node.id}`);
    }
  }

  visit(root, []);
}
/* ============================
   PROJECTION EMITERS AVRO 
============================ */

function emitSchema(node, projection) {
  // schema node normally has exactly one child (the root type)
  const [typeChildId] = node.children;
  const typeChild = projection.nodes.get(typeChildId);

  return emitNode(typeChild, projection);
}

function emitRecord(node, projection) {
  const result = {};

  // copy Avro-native attributes
  Object.assign(result, node.attributes.native);

  // fields must be rebuilt from children
  result.fields = node.children.map((fieldId) => {
    const fieldNode = projection.nodes.get(fieldId);
    return emitNode(fieldNode, projection);
  });

  return result;
}

function emitField(node, projection) {
  const result = {};

  Object.assign(result, node.attributes.native);

  // field must have exactly one type child
  const [typeChildId] = node.children;
  const typeNode = projection.nodes.get(typeChildId);

  result.type = emitNode(typeNode, projection);

  return result;
}

function emitUnion(node, projection) {
  return node.children.map((childId) => {
    const child = projection.nodes.get(childId);
    return emitNode(child, projection);
  });
}

function emitArray(node, projection) {
  const result = {};

  Object.assign(result, node.attributes.native);

  const [itemsId] = node.children;
  const itemsNode = projection.nodes.get(itemsId);

  result.items = emitNode(itemsNode, projection);

  return result;
}

function emitMap(node, projection) {
  const result = {};

  Object.assign(result, node.attributes.native);

  const [valuesId] = node.children;
  const valuesNode = projection.nodes.get(valuesId);

  result.values = emitNode(valuesNode, projection);

  return result;
}

function emitEnum(node) {
  // enum is emitted exactly as declared
  return {
    ...node.attributes.native,
  };
}

function emitFixed(node) {
  // Fixed types are emitted exactly as declared
  return {
    ...node.attributes.native,
  };
}

function emitPrimitive(node) {
  const native = node.attributes.native;

  // Emit exactly what's stored (preserve original format)
  // - If it was a string ("int"), emit the string
  // - If it was an object ({type: "int", logicalType: "date"}), emit the object
  return native;
}

/* ============================
   COPY / CLONE NODES
============================ */

function cloneSubtree(sourceNodeOrId, projection) {
  const sourceNode = typeof sourceNodeOrId === "string"
    ? projection.nodes.get(sourceNodeOrId)
    : sourceNodeOrId;
  const clonedNodes = [];

  function cloneNodeRecursive(node, parentId = null) {
    const newId = newNodeId();

    const clonedNode = {
      id: newId,
      kind: node.kind,
      parentId,
      children: [],
      attributes: cloneAttributes(node.attributes),
      path: undefined,
    };

    clonedNodes.push(clonedNode);

    for (const childId of node.children) {
      const childNode = projection.nodes.get(childId);
      if (!childNode) {
        throw new Error(`cloneSubtree: missing child ${childId}`);
      }

      const clonedChild = cloneNodeRecursive(childNode, newId);
      clonedNode.children.push(clonedChild.id);
    }

    return clonedNode;
  }

  const root = cloneNodeRecursive(sourceNode);
  return { root, nodes: clonedNodes };
}

/* ============================
   ASSERTIONS
============================ */

function assertProjectionComplete(projection) {
  for (const node of projection.nodes.values()) {
    if (!node.kind) throw new Error("Node missing kind");
    if (!node.id) throw new Error("Node missing id");

    if (node.kind === "field" && node.children.length !== 1) {
      throw new Error("Field must have exactly one type child");
    }

    if (node.kind === "union" && node.children.length === 0) {
      throw new Error("Union must have branches");
    }
  }
  assertAllPathsDefined(projection);
}

function assertAllPathsDefined(projection) {
  for (const node of projection.nodes.values()) {
    if (!Array.isArray(node.path)) {
      throw new Error(`Node ${node.id} has invalid path`);
    }
  }
}

/* ============================
   SCHEMA STATS
============================ */

function calculateSchemaStats(projection) {
  let fieldCount = 0;
  let maxDepth = 0;

  function getDepth(nodeId, depth = 0) {
    maxDepth = Math.max(maxDepth, depth);
    const node = projection.nodes.get(nodeId);
    if (!node) return;

    if (node.kind === "field") {
      fieldCount++;
    }

    for (const childId of node.children) {
      getDepth(childId, depth + 1);
    }
  }

  if (projection.rootId) {
    getDepth(projection.rootId);
  }

  return { fieldCount, maxDepth };
}
