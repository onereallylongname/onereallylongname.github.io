/* ============================
  ACTION VALIDATIONS
============================ */

function validateMove(node, target) {
  return canInsertIntoSlot({ slot: getSlotsForNode(target), node });
}

/**
 * Guard: prevents remove/move on nodes that would leave a single-slot parent empty.
 * Union branches (multi-slot) are allowed. Fields in records are allowed.
 * Only type nodes in field.type / array.items / map.values are blocked.
 */
function assertNotSingleSlotChild(node, projection, action) {
  if (isInSingleSlot(node, projection)) {
    throw new Error(
      `Cannot ${action} node ${node.id}: it is the sole type child of ${node.parentId}. Use replaceTypeCommand instead.`,
    );
  }
}

/* ============================
  ATTRIBUTES ACTIONS
============================ */

function updateAttributeCommand(
  {
    nodeId,
    scope, // "native" | "custom"
    key, // attribute name
    newValue,
    description,
  },
  projection,
  refreshAction,
) {
  const node = projection.nodes.get(nodeId);

  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  const oldValue = node.attributes[scope][key];

  return new Command(
    () => {
      node.attributes[scope][key] = newValue;
    },
    () => {
      if (oldValue === undefined) {
        delete node.attributes[scope][key];
      } else {
        node.attributes[scope][key] = oldValue;
      }
    },
    refreshAction,
    description || `Update ${scope}.${key}`,
  );
}

/* ============================
  MOVE FIELD
============================ */

function moveNodeCommand(
  { nodeId, targetNodeId, slot, index, description },
  projection,
  refreshAction,
) {
  const node = projection.nodes.get(nodeId);
  if (!node) throw new Error(`Node not found: ${nodeId}`);

  assertNotSingleSlotChild(node, projection, "move");

  const oldParent = projection.nodes.get(node.parentId);
  if (!oldParent) throw new Error(`Old parent not found for ${nodeId}`);

  const targetNode = projection.nodes.get(targetNodeId);
  if (!targetNode) throw new Error(`Target node not found: ${targetNodeId}`);

  // Resolve children collections
  const oldChildren = oldParent.children;
  const newChildren = getSlotChildren(targetNode, slot);

  const oldIndex = oldChildren.indexOf(nodeId);
  if (oldIndex === -1) {
    throw new Error(
      `Invariant violation: node ${nodeId} not found in old parent children`,
    );
  }

  // Compute insertion index (position in the target array after source removal)
  const sameParent = oldParent === targetNode;
  let insertIndex;
  if (index === undefined) {
    // Append: for same parent, length-1 since source will be removed first
    insertIndex = sameParent ? newChildren.length - 1 : newChildren.length;
  } else {
    insertIndex = index;
  }

  return new Command(
    // DO
    () => {
      // detach
      oldChildren.splice(oldIndex, 1);

      // attach
      newChildren.splice(insertIndex, 0, nodeId);

      // update parent reference
      node.parentId = targetNodeId;
    },

    // UNDO
    () => {
      // detach from new location
      const idx = newChildren.indexOf(nodeId);
      if (idx === -1) {
        throw new Error(
          `Invariant violation: node ${nodeId} not found during undo`,
        );
      }
      newChildren.splice(idx, 1);

      // restore old location
      oldChildren.splice(oldIndex, 0, nodeId);
      node.parentId = oldParent.id;
    },

    refreshAction,
    description || `Move node ${nodeId}`,
  );
}

/* ============================
  CREATE FIELD
============================ */

function createNodeCommand(
  { newSubtree, targetNodeId, slot, index, description },
  projection,
  refreshAction,
) {
  const { root, nodes } = newSubtree;

  const targetNode = projection.nodes.get(targetNodeId);
  if (!targetNode) throw new Error(`Target node not found: ${targetNodeId}`);

  const children = getSlotChildren(targetNode, slot);
  let insertIndex = index ?? children.length;

  return new Command(
    // DO
    () => {
      // Register all nodes in the subtree
      for (const node of nodes) {
        projection.nodes.set(node.id, node);
      }

      // Attach root to target slot
      children.splice(insertIndex, 0, root.id);
      root.parentId = targetNodeId;
    },

    // UNDO
    () => {
      // Detach root
      const idx = children.indexOf(root.id);
      if (idx !== -1) children.splice(idx, 1);

      // Remove entire subtree
      for (const node of nodes) {
        projection.nodes.delete(node.id);
      }
    },

    refreshAction,
    description || "Create node",
  );
}

/* ============================
  COPY FIELD
============================ */

function copyNodeCommand(
  { sourceNodeId, targetNodeId, slot, index, description },
  projection,
  refreshAction,
) {
  const source = projection.nodes.get(sourceNodeId);
  if (!source) throw new Error("Source not found");

  if (isTypeNode(source, projection)) {
    throw new Error("Cannot copy a type node");
  }

  const newSubtree = cloneSubtree(source, projection);

  return createNodeCommand(
    {
      newSubtree,
      targetNodeId,
      slot,
      index,
      description: description || `Copy field`,
    },
    projection,
    refreshAction,
  );
}

/* ============================
  REMOVE NODES
============================ */

function removeNodeCommand({ nodeId, description }, projection, refreshAction) {
  const node = projection.nodes.get(nodeId);
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  assertNotSingleSlotChild(node, projection, "remove");

  const parent = projection.nodes.get(node.parentId);
  if (!parent) {
    throw new Error(`Parent not found for node ${nodeId}`);
  }

  const children = parent.children;
  const index = children.indexOf(nodeId);
  if (index === -1) {
    throw new Error(`Invariant violation: node not in parent children`);
  }

  // Capture entire subtree (existing nodes, not clones)
  const subtreeNodes = collectExistingSubtree(node, projection);

  return new Command(
    // DO
    () => {
      // detach from parent
      children.splice(index, 1);

      // remove subtree
      for (const n of subtreeNodes) {
        projection.nodes.delete(n.id);
      }
    },

    // UNDO
    () => {
      // re-register subtree
      for (const n of subtreeNodes) {
        projection.nodes.set(n.id, n);
      }

      // reattach at same position
      children.splice(index, 0, nodeId);
      node.parentId = parent.id;
    },

    refreshAction,
    description || `Remove node ${nodeId}`,
  );
}

/* ============================
  REPLACE TYPE
  Atomically swap a type child in a single-slot parent
  (field.type, array.items, map.values).
============================ */

function replaceTypeCommand(
  { parentNodeId, newTypeSpec, description },
  projection,
  refreshAction,
) {
  const parent = projection.nodes.get(parentNodeId);
  if (!parent) throw new Error(`Parent not found: ${parentNodeId}`);

  if (parent.kind !== "field" && parent.kind !== "array" && parent.kind !== "map") {
    throw new Error(`replaceType only works on field/array/map, got: ${parent.kind}`);
  }

  const oldTypeId = parent.children[0];
  if (!oldTypeId) throw new Error(`Parent ${parentNodeId} has no type child`);

  // Capture old subtree for undo
  const oldTypeNode = projection.nodes.get(oldTypeId);
  const oldSubtreeNodes = collectExistingSubtree(oldTypeNode, projection);

  // Build new type subtree
  const newSubtree = buildTypeSubtree(newTypeSpec, parentNodeId);

  return new Command(
    // DO
    () => {
      // Remove old type subtree
      for (const n of oldSubtreeNodes) {
        projection.nodes.delete(n.id);
      }
      parent.children = [];

      // Insert new type subtree
      for (const n of newSubtree.nodes) {
        projection.nodes.set(n.id, n);
      }
      parent.children = [newSubtree.root.id];
      newSubtree.root.parentId = parentNodeId;
    },

    // UNDO
    () => {
      // Remove new subtree
      for (const n of newSubtree.nodes) {
        projection.nodes.delete(n.id);
      }
      parent.children = [];

      // Restore old subtree
      for (const n of oldSubtreeNodes) {
        projection.nodes.set(n.id, n);
      }
      parent.children = [oldTypeId];
      oldTypeNode.parentId = parentNodeId;
    },

    refreshAction,
    description || `Replace type on ${parent.kind} ${parentNodeId}`,
  );
}

/* ============================
  Actions helpers
============================ */

function getValidMoveTargets(nodeId, projection) {
  const node = projection.nodes.get(nodeId);
  if (!node) return [];

  // Nodes in single-slot positions can't be moved (use replaceType instead)
  if (isInSingleSlot(node, projection)) return [];

  const role = getNodeAvroRole(node);
  const results = [];

  for (const target of projection.nodes.values()) {
    // Structural exclusions
    if (target.id === nodeId) continue;
    if (isDescendant(projection, nodeId, target.id)) continue;

    const slots = getSlotsForNode(target);

    for (const { slot, multiple } of slots) {
      // Role compatibility
      if (!SLOT_ACCEPTS[slot]?.includes(role)) continue;

      // Cardinality handling
      if (multiple) {
        const childCount = target.children.length;
        for (let i = 0; i <= childCount; i++) {
          results.push({
            targetNodeId: target.id,
            slot,
            index: i,
          });
        }
      } else {
        // single-slot: only if empty OR replacement allowed (later)
        if (target.children.length === 0) {
          results.push({
            targetNodeId: target.id,
            slot,
          });
        }
      }
    }
  }
  return results;
}
