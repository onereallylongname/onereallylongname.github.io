/* ============================
   SEARCH ENGINE
   Pure query functions over projection nodes.
   No DOM dependency — fully testable.
   Uses fuzzy() and similarity() from strings.js.
============================ */

/**
 * Query projection nodes by filter criteria.
 * All filters are optional. Uses fuzzy subsequence matching.
 *
 * Excludes primitive/named type nodes from results — their info is surfaced
 * through the parent field's type property. This prevents noise where
 * searching "string" would return every primitive "string" node.
 *
 * @param {Object} projection - The projection to search
 * @param {Object} filters - Search criteria (all optional)
 * @param {string} [filters.name]      - Match field/record/enum/fixed name
 * @param {string} [filters.type]      - Match type kind or native type
 * @param {string} [filters.parent]    - Match parent record name
 * @param {string} [filters.namespace] - Match namespace
 * @param {string} [filters.text]      - Free-text: fuzzy match against all properties
 * @returns {Array<{nodeId: string, node: Object, score: number}>} Sorted by score descending
 */
function queryNodes(projection, filters) {
  if (!projection || !filters) return [];

  const activeFilters = Object.entries(filters).filter(
    ([, v]) => typeof v === "string" && v.trim().length > 0,
  );
  if (activeFilters.length === 0) return [];

  const results = [];
  const EXCLUDED_KINDS = { primitive: true, named: true, schema: true, union: true, array: true, map: true };

  for (const [nodeId, node] of projection.nodes) {
    if (EXCLUDED_KINDS[node.kind]) continue;
    const score = scoreNode(node, projection, filters, activeFilters);
    if (score > 0) {
      results.push({ nodeId, node, score });
    }
  }

  // Remove records that have a descendant also in results (child is the real target)
  const matchedIds = new Set(results.map(r => r.nodeId));
  const filtered = results.filter(r => {
    if (r.node.kind !== "record") return true;
    return !hasDescendantInSet(r.node, projection, matchedIds);
  });

  filtered.sort((a, b) => b.score - a.score);
  return filtered;
}

/**
 * Score a node against active filters.
 * All specified filters must match (AND logic). Score is sum of individual match quality.
 */
function scoreNode(node, projection, filters, activeFilters) {
  const props = getSearchableProps(node, projection);
  let total = 0;
  let matched = 0;

  for (const [key, pattern] of activeFilters) {
    if (key === "text") {
      // Free-text: match against ALL props, take best
      const best = Math.max(
        fuzzyScore(props.name, pattern) * 3,
        typeComponentScore(props.type, pattern) * 2,
        fuzzyScore(props.parent, pattern),
        fuzzyScore(props.namespace, pattern),
      );
      if (best > 0) {
        total += best;
        matched++;
      }
    } else if (key === "type") {
      // Type uses component matching (split by comma, exact/prefix per component)
      const score = typeComponentScore(props.type, pattern);
      if (score > 0) {
        total += score * 2;
        matched++;
      }
    } else {
      const target = props[key] || "";
      const score = fuzzyScore(target, pattern);
      if (score > 0) {
        total += score * (key === "name" ? 3 : 2);
        matched++;
      }
    }
  }

  // AND logic: all specified filters must match
  return matched === activeFilters.length ? total : 0;
}

/**
 * Score a type label against a search term using component matching.
 * Splits label by comma and checks each component for exact/prefix match.
 * Prevents false positives like "int" matching "union,null,string".
 */
function typeComponentScore(typeLabel, needle) {
  if (!typeLabel || !needle) return 0;
  const components = typeLabel.toLowerCase().split(",");
  const n = needle.toLowerCase();
  let best = 0;
  for (const comp of components) {
    if (comp === n) { best = Math.max(best, 1.0); break; }
    if (comp.startsWith(n)) best = Math.max(best, 0.9);
  }
  return best;
}

/**
 * Fuzzy score: 0 = no match, higher = better match.
 * Uses the fuzzy() subsequence test from strings.js, then similarity() for ranking.
 */
function fuzzyScore(haystack, needle) {
  if (!haystack || !needle) return 0;

  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();

  // Exact match — highest score
  if (h === n) return 1.0;

  // Prefix match — very high
  if (h.startsWith(n)) return 0.9;

  // Subsequence match via fuzzy()
  if (!fuzzy(haystack, needle)) return 0;

  // Score based on Levenshtein similarity
  return similarity(h, n) * 0.8;
}

/**
 * Extract all searchable properties from a node.
 */
function getSearchableProps(node, projection) {
  const native = node.attributes.native;
  const props = { name: "", type: "", parent: "", namespace: "" };

  // Name (fields, records, enums, fixed)
  if (typeof native === "object" && native.name) {
    props.name = native.name;
  }

  // Namespace (records, enums, fixed)
  if (typeof native === "object" && native.namespace) {
    props.namespace = native.namespace;
  }

  // Type label
  props.type = getNodeTypeLabel(node, projection);

  // Parent record name (walk up tree)
  const parentRecord = findAncestorRecord(node, projection);
  if (parentRecord) {
    props.parent = parentRecord.attributes.native.name || "";
  }

  return props;
}

/**
 * Human-readable type label for a node (used for type matching).
 * Returns comma-separated list of applicable type names.
 * Includes both base type and logical type when present (e.g., "bytes,decimal").
 */
function getNodeTypeLabel(node, projection) {
  switch (node.kind) {
    case "field": {
      const typeChild = projection.nodes.get(node.children[0]);
      return typeChild ? getNodeTypeLabel(typeChild, projection) : "";
    }
    case "primitive":
    case "named":
      if (typeof node.attributes.native === "string") {
        return node.attributes.native;
      }
      // Include both base type and logical type so both are searchable
      if (node.attributes.native.logicalType) {
        return node.attributes.native.type + "," + node.attributes.native.logicalType;
      }
      return node.attributes.native.type || node.kind;
    case "record":
    case "enum":
    case "fixed":
      return node.kind;
    case "array":
      return "array";
    case "map":
      return "map";
    case "union": {
      // Include branch type labels so t:string finds ["null","string"] fields
      const branches = (node.children || [])
        .map(id => projection.nodes.get(id))
        .filter(Boolean)
        .map(child => getNodeTypeLabel(child, projection));
      return ["union", ...branches].join(",");
    }
    default:
      return node.kind;
  }
}

/**
 * Walk up to find the nearest ancestor with kind "record".
 */
function findAncestorRecord(node, projection) {
  let current = node;
  while (current.parentId) {
    const parent = projection.nodes.get(current.parentId);
    if (!parent) return null;
    if (parent.kind === "record") return parent;
    current = parent;
  }
  return null;
}

/**
 * Check if any descendant of a node is in the given ID set.
 * Used to suppress records from results when a child field is the real match.
 */
function hasDescendantInSet(node, projection, idSet) {
  for (const childId of node.children || []) {
    if (idSet.has(childId)) return true;
    const child = projection.nodes.get(childId);
    if (child && hasDescendantInSet(child, projection, idSet)) return true;
  }
  return false;
}
