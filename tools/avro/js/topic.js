/* --------------------------------------------------------------------------
  Start Variables
--------------------------------------------------------------------------*/

const URI_TOPIC_PARAM_NAME = "topic";
let lastResults;
let validationDebounce;

/* --------------------------------------------------------------------------
ISO COUNTRY LIST src: https://www.iso.org/iso-3166-country-codes
--------------------------------------------------------------------------*/
const COUNTRY_VALUES = [
  "group",
  "af",
  "al",
  "dz",
  "as",
  "ad",
  "ao",
  "ai",
  "aq",
  "ag",
  "ar",
  "am",
  "aw",
  "au",
  "at",
  "az",
  "bs",
  "bh",
  "bd",
  "bb",
  "by",
  "be",
  "bz",
  "bj",
  "bm",
  "bt",
  "bo",
  "bq",
  "ba",
  "bw",
  "bv",
  "br",
  "io",
  "bn",
  "bg",
  "bf",
  "bi",
  "cv",
  "kh",
  "cm",
  "ca",
  "ky",
  "cf",
  "td",
  "cl",
  "cn",
  "cx",
  "cc",
  "co",
  "km",
  "cd",
  "cg",
  "ck",
  "cr",
  "hr",
  "cu",
  "cw",
  "cy",
  "cz",
  "ci",
  "dk",
  "dj",
  "dm",
  "do",
  "ec",
  "eg",
  "sv",
  "gq",
  "er",
  "ee",
  "sz",
  "et",
  "fk",
  "fo",
  "fj",
  "fi",
  "fr",
  "gf",
  "pf",
  "tf",
  "ga",
  "gm",
  "ge",
  "de",
  "gh",
  "gi",
  "gr",
  "gl",
  "gd",
  "gp",
  "gu",
  "gt",
  "gg",
  "gn",
  "gw",
  "gy",
  "ht",
  "hm",
  "va",
  "hn",
  "hk",
  "hu",
  "is",
  "in",
  "id",
  "ir",
  "iq",
  "ie",
  "im",
  "it",
  "jm",
  "jp",
  "je",
  "jo",
  "kz",
  "ke",
  "ki",
  "kp",
  "kr",
  "kw",
  "kg",
  "la",
  "lv",
  "lb",
  "ls",
  "lr",
  "ly",
  "li",
  "lt",
  "lu",
  "mo",
  "mg",
  "mw",
  "my",
  "mv",
  "ml",
  "mt",
  "mh",
  "mq",
  "mr",
  "mu",
  "yt",
  "mx",
  "fm",
  "md",
  "mc",
  "mn",
  "me",
  "ms",
  "ma",
  "mz",
  "mm",
  "na",
  "nr",
  "np",
  "nl",
  "nc",
  "nz",
  "ni",
  "ne",
  "ng",
  "nu",
  "nf",
  "mp",
  "no",
  "om",
  "pk",
  "pw",
  "ps",
  "pa",
  "pg",
  "py",
  "pe",
  "ph",
  "pn",
  "pl",
  "pt",
  "pr",
  "qa",
  "mk",
  "ro",
  "ru",
  "rw",
  "re",
  "bl",
  "sh",
  "kn",
  "lc",
  "mf",
  "pm",
  "vc",
  "ws",
  "sm",
  "st",
  "sa",
  "sn",
  "rs",
  "sc",
  "sl",
  "sg",
  "sx",
  "sk",
  "si",
  "sb",
  "so",
  "za",
  "gs",
  "ss",
  "es",
  "lk",
  "sd",
  "sr",
  "sj",
  "se",
  "ch",
  "sy",
  "tw",
  "tj",
  "tz",
  "th",
  "tl",
  "tg",
  "tk",
  "to",
  "tt",
  "tn",
  "tr",
  "tm",
  "tc",
  "tv",
  "ug",
  "ua",
  "ae",
  "gb",
  "um",
  "us",
  "uy",
  "uz",
  "vu",
  "ve",
  "vn",
  "vg",
  "vi",
  "wf",
  "eh",
  "ye",
  "zm",
  "zw",
  "ax",
];

// Populate autocomplete list
(() => {
  const dl = document.getElementById("countryList");
  COUNTRY_VALUES.forEach((c) => {
    let o = document.createElement("option");
    o.value = c;
    dl.appendChild(o);
  });
})();

/* --------------------------------------------------------------------------
   VALIDATOR CONSTANTS
   --------------------------------------------------------------------------*/

const SEGMENT_NAMES = [
  "usage",
  "type",
  "country",
  "dataArea",
  "subArea",
  "entity",
  "version",
];
const MANDATORY_SEGMENT_NAMES = ["usage", "type", "country", "version"];
const VALIDATION_NAMES = ["numSegments"];
const VALID_USAGE = ["public", "internal", "fullload", "archive", "dlq"];
const VALID_TYPE = ["raw", "cdc", "sdm", "idm"];
const SGM_MINIMUM = 5;
const ALLOWED_SDM_USAGE = ["public", "fullload", "archive", "dlq"]; // internal disabled

// strict version regex (only "-" for scope)
const versionRegex = /^v[0-9][0-9._,]*(\-[A-Za-z0-9._-]+)?$/;

/* --------------------------------------------------------------------------
   VALIDATE TOPIC
   --------------------------------------------------------------------------*/

function parseTopic(topic) {
  const out = {
    valid: false,
    validResult: "",
    segments: {},
    misplacedSements: [],
  };

  // Setup defaults
  SEGMENT_NAMES.forEach((name) => {
    out.segments[name] = {};
    out.segments[name].name = name;
    out.segments[name].isSegment = true;
    out.segments[name]["errors"] = [];
    out.segments[name]["warnings"] = [];
    out.segments[name]["fixes"] = [];
  });

  VALIDATION_NAMES.forEach((name) => {
    out.segments[name] = {};
    out.segments[name].name = name;
    out.segments[name].isSegment = false;
    out.segments[name]["errors"] = [];
    out.segments[name]["warnings"] = [];
    out.segments[name]["fixes"] = [];
  });

  const seg = topic.trim().split(".");
  const total = seg.length;

  out.segments.numSegments.value = total;
  if (total < SGM_MINIMUM) {
    out.segments.numSegments.errors.push(
      `Topic must have at least ${SGM_MINIMUM} segments but has only ${total}`,
    );
    out.valid = false;
    out.segments.numSegments.fixes.push(
      `Respect the schema usage.type.country.dataArea.subArea.entity.version[-scope]`,
    );
    out.validResult = asErrorSpan(
      topic.trim(),
      out.segments.numSegments.errors,
    );
  }

  /* ---------------------- USAGE ---------------------- */
  let currentIndex = 0;
  const usage = seg[currentIndex].trim();
  if (!VALID_USAGE.includes(usage)) {
    out.segments.usage.errors.push(`Invalid usage "${usage}".`);

    let didYouMean = bestMatch(usage, VALID_USAGE);
    if (didYouMean) {
      out.segments.usage.fixes.push(`Did you mean "${didYouMean}"`);
    }
  }
  out.segments.usage.value = usage;

  /* ---------------------- TYPE ---------------------- */
  const type =
    seg[currentIndex + 1] === null || seg[currentIndex + 1] === undefined
      ? ""
      : seg[currentIndex + 1].trim();
  if (!VALID_TYPE.includes(type)) {
    out.segments.type.errors.push(`Invalid type "${type}".`);
    let didYouMean = bestMatch(type, VALID_TYPE);
    if (didYouMean) {
      out.segments.type.fixes.push(`Did you mean "${didYouMean}"`);
      currentIndex += 1;
      out.segments.type.value = type;
    } else if (VALID_TYPE.includes(usage)) {
      let didYouMean = bestMatch(usage, VALID_TYPE);
      if (didYouMean) {
        out.segments.type.fixes.push(`Did you mean "${didYouMean}"`);
      }
      out.segments.type.value = usage;
      out.segments.usage.value = null;
    }
  } else {
    currentIndex += 1;
    out.segments.type.value = type;
  }

  /* ---------------------- COUNTRY FALLBACK ---------------------- */
  let country = null;

  const countryCandidates = [1, 2, 3]
    .map((i) => currentIndex + i)
    .filter((i) => i < total - 1);

  for (let i of countryCandidates) {
    if (COUNTRY_VALUES.includes(seg[i])) {
      country = seg[i];
      currentIndex = i;
      break;
    }
    if (seg[i].length <= 2 && seg[i].length > 0) {
      out.segments.country.errors.push(`Invalid country value ${seg[i]}`);

      out.segments.country.fixes.push(
        `Did you mean one of: ${COUNTRY_VALUES.filter((c) => c[0] === seg[i][0]).join(", ")}?`,
      );
      country = seg[i];
      currentIndex = i;
      break;
    }
  }

  /* Country FOUND somewhere in 2..4 */
  if (country !== null) {
    out.segments.country.value = country;

    const displacement = currentIndex - 2;

    if (displacement > 0) {
      const misplaced = seg.slice(2, currentIndex);
      out.segments.numSegments.warnings.push(
        `Missplaced ${misplaced} at position ${currentIndex - 2}`,
      );

      out.segments.country.warnings.push(
        `Country segment found ${displacement} position(s) later than expected.`,
      );
      out.segments.country.warnings.push(
        `Out-of-place leading segments: ${misplaced.join(", ")}`,
      );

      out.misplacedSements = out.misplacedSements.concat(
        misplaced.map((m, index) =>
          createMissplacedString(m, currentIndex - 1 + index),
        ),
      );
    }

    // Remaining middle = between country and version
    const middleStart = currentIndex + 1;

    // Version
    let versionPos = 1;
    while (total - versionPos > middleStart) {
      const versionSeg = seg[total - versionPos];
      versionPos += 1;
      if (versionRegex.test(versionSeg)) {
        out.segments.version.value = versionSeg;
        break;
      }
    }

    if (!out.segments.version.value) {
      // reset version position
      versionPos = 1;
      // add error
      let segAtVersionPosition =
        seg[
          Math.min(SEGMENT_NAMES.length, total) -
            1 +
            out.misplacedSements.length
        ];
      out.segments.version.errors.push(
        `Version not found or Invalid version format '${segAtVersionPosition}'.`,
      );
      out.segments.version.fixes.push(
        `Add a version at the end or replace the value '${segAtVersionPosition}'. For exmaple v1`,
      );
    }

    // Middle always interpreted normally
    const middle = seg.slice(middleStart, total - Math.max(1, versionPos - 1));

    out.segments.dataArea.value = middle[0] ?? null;
    out.segments.subArea.value = middle[1] ?? null;
    out.segments.entity.value = middle[2] ?? null;

    if (middle.length > 3) {
      out.misplacedSements = out.misplacedSements.concat(
        middle
          .slice(3)
          .map((m, index) =>
            createMissplacedString(m, currentIndex + 4 + index),
          ),
      );
    }
  } else {
    /* ---------------------- NO COUNTRY FOUND ---------------------- */

    out.segments.country.errors.push(
      "Missing or invalid country. Must match <a target='_blank' href='https://www.iso.org/iso-3166-country-codes.html'>ISO-3166-1</a> or 'group'.",
    );
    out.segments.country.fixes.push(
      "If in doubt you can use 'group' else use the BU country",
    );

    let middleStart = 2 + out.misplacedSements.length;
    // Version
    let versionPos = 1;
    while (total - versionPos > middleStart) {
      const versionSeg = seg[total - versionPos];
      versionPos += 1;
      if (versionRegex.test(versionSeg)) {
        out.segments.version.value = versionSeg;
        break;
      }
    }

    if (!out.segments.version.value) {
      // reset version position
      versionPos = 1;
      // add error
      let segAtVersionPosition =
        seg[
          Math.min(SEGMENT_NAMES.length, total) -
            1 +
            out.misplacedSements.length
        ];
      out.segments.version.errors.push(
        `Version not found or Invalid version format '${segAtVersionPosition}'.`,
      );
      out.segments.version.fixes.push(
        `Add a version at the end or replace the value '${segAtVersionPosition}'. For exmaple v1`,
      );
    }

    // Middle always interpreted normally
    const middle = seg.slice(middleStart, total - Math.max(1, versionPos - 1));

    out.segments.country.value = null;
    out.segments.dataArea.value = middle[0] ?? null;
    out.segments.subArea.value = middle[1] ?? null;
    out.segments.entity.value = middle[2] ?? null;

    if (middle.length > 3) {
      out.misplacedSements = out.misplacedSements.concat(
        middle
          .slice(3)
          .map((m, index) =>
            createMissplacedString(m, currentIndex + 4 + index),
          ),
      );
    }
  }

  /* ---------------------- DATA EXTRA VALODATIONS ---------------------- */
  let dataArea = out.segments.dataArea.value;
  let subArea = out.segments.subArea.value;
  let entity = out.segments.entity.value;

  // If all data areas are null there is an error
  if (
    dataArea === subArea &&
    subArea === entity &&
    (entity == null || entity === "")
  ) {
    if (type === "sdm") {
      out.segments.dataArea.errors.push(
        "The dataArea must have a value on type 'SDM'",
      );
      out.segments.dataArea.fixes.push(
        "Add a value to the dataArea describing the  BU or area (e.g.: finance, supplychain, logistics, inventory, etc…)",
      );
    } else if (type === "raw" || type === "cdc") {
      out.segments.entity.errors.push(
        `The entity must have a value on type ${type}`,
      );
      out.segments.entity.fixes.push(
        "Add a value to the entity describing the name of the entity being produced/consumed",
      );
    } else {
      out.segments.dataArea.errors.push("The dataArea shoud have a value");
    }
  } else {
    /* SDM rules */
    if (type === "sdm") {
      if (!dataArea) {
        out.segments.dataArea.errors.push("SDM requires a dataArea.");
      }

      if (!ALLOWED_SDM_USAGE.includes(usage)) {
        out.segments.type.warnings.push("SDM cannot use internal as usage.");
        out.segments.type.fixes.push(
          `Change the usage to one of ${ALLOWED_SDM_USAGE.join(", ")}`,
        );
      }
    } else {
      if (!subArea) {
        out.segments.subArea.warnings.push(
          "Non SDM types should have a subArea.",
        );
      }
    }
  }

  if (
    subArea === entity &&
    !(entity == "" || entity == null || entity === undefined)
  ) {
    out.segments.entity.warnings.push(
      "If entity is equal to the subArea it can be omitted",
    );
    out.segments.entity.fixes.push("Omitte the entity");
  }

  /* ---------------------- Compute misplacedSements ---------------------- */
  if (total > SEGMENT_NAMES.length) {
    out.segments.numSegments.warnings.push(
      `Topic must have at most ${SEGMENT_NAMES.length} segments but has ${total}`,
    );
    let startAt = SEGMENT_NAMES.length + out.misplacedSements.length;
    let toRemove = out.misplacedSements.concat(
      seg
        .slice(startAt)
        .map((m, index) => createMissplacedString(m, startAt + index)),
    );
    out.misplacedSements.push(toRemove);
    out.segments.numSegments.fixes.push(
      `Remove the segments ${toRemove.join(", ")}`,
    );
  } else if (out.misplacedSements.length > 0) {
    let toRemove = out.misplacedSements.join(", ");
    out.segments.numSegments.warnings.push(`Missplaced segments ${toRemove}`);
    out.segments.numSegments.fixes.push(`Remove the segments ${toRemove}`);
  }

  /* ---------------------- FINAL VALID FLAG ---------------------- */
  let numErrors = 0;
  for (let [_, seg] of Object.entries(out.segments)) {
    numErrors += seg.errors.length;
  }

  out.valid = numErrors == 0;

  /* ---------------------- REBUILD RESULT ---------------------- */
  if (!out.validResult) {
    let rebuilt = SEGMENT_NAMES.map((name) =>
      rebuildDisplay(out.segments[name]),
    )
      .filter((s) => s != null)
      .join(".");
    out.validResult = rebuilt;
  }

  return out;
}

/* --------------------------------------------------------------------------
   VALIDATOR UI
   --------------------------------------------------------------------------*/

function runValidation() {
  const input = document.getElementById("validatorInput").value.trim();
  const box = document.getElementById("validatorResult");

  if (!input) {
    box.innerHTML = "Please enter a topic.";
    return;
  }

  const result = parseTopic(input);

  let html = `<strong>Status:</strong> ${
    result.valid
      ? "<span class='badge badge-ok'>VALID</span>"
      : "<span class='badge badge-error'>INVALID</span>"
  }<br><br>`;

  html += `<strong>Reconstructed:</strong> ${result.validResult}<br><br>`;

  html += `<strong>Validations:</strong><br><table>`;
  for (let [k, v] of Object.entries(result.segments)) {
    let mandatory = MANDATORY_SEGMENT_NAMES.includes(v.name);
    let valid = mandatory
      ? v.errors.length === 0 && v.value !== undefined
      : v.errors.length === 0;
    let validSymbol = !valid ? "❌" : v.warnings.length === 0 ? "✅" : "⚠️";
    let fixes = v.fixes.length === 0 ? "" : "🛠️ " + v.fixes.join(" 🛠️ ");
    let otherMessages =
      (v.errors.length === 0 ? "" : "‼️" + v.errors.join(" ‼️")) +
      (v.warnings.length === 0 ? "" : " ❕" + v.warnings.join(" ❕ "));
    html += `<tr><td>${validSymbol}</td> <td>${k}</td> <td><code>${v.value}</code></td><td>${fixes}</td><td>${otherMessages}</td></tr>`;
  }
  html += `</table>`;

  box.innerHTML = html;
  lastResults = result;

  setParam(URI_TOPIC_PARAM_NAME, input);
}

/* --------------------------------------------------------------------------
   BUILDER (REAL-TIME)
   --------------------------------------------------------------------------*/

function adjustBuilderForType() {
  const type = document.getElementById("b_type").value;
  const usage = document.getElementById("b_usage");

  if (type === "sdm") {
    if (usage.value === "internal") usage.value = "public"; // auto-correct
    usage.querySelector("option[value='internal']").disabled = true;
  } else {
    usage.querySelector("option[value='internal']").disabled = false;
  }
}

function enforceCountry() {
  const f = document.getElementById("b_country");
  if (!COUNTRY_VALUES.includes(f.value.trim())) f.value = "group";
}

function loadValidatorIntoBuilder() {
  const topic = document.getElementById("validatorInput").value.trim();
  if (!topic) return;

  const result = parseTopic(topic);
  const seg = result.segments;

  document.getElementById("b_usage").value = seg.usage.value || "";
  document.getElementById("b_type").value = seg.type.value || "";
  document.getElementById("b_country").value = seg.country.value || "";

  document.getElementById("b_dataArea").value = seg.dataArea.value || "";
  document.getElementById("b_subArea").value = seg.subArea.value || "";
  document.getElementById("b_entity").value = seg.entity.value || "";

  let version = seg.version.value || "";
  let vn = "";
  let sc = "";

  if (version.startsWith("v")) {
    const parts = version.substring(1).split("-");
    vn = parts[0] || "";
    sc = parts[1] || "";
  }

  document.getElementById("b_versionNum").value = vn;
  document.getElementById("b_scope").value = sc;

  adjustBuilderForType();
  buildTopic();
}

function buildTopic() {
  const usage = document.getElementById("b_usage").value;
  const type = document.getElementById("b_type").value;
  const country = document.getElementById("b_country").value;

  const da = document.getElementById("b_dataArea").value.trim();
  const sa = document.getElementById("b_subArea").value.trim();
  const en = document.getElementById("b_entity").value.trim();

  const vn = document.getElementById("b_versionNum").value.trim() || "1";
  const sc = document.getElementById("b_scope").value.trim();

  let version = "v" + vn;
  if (sc) version += "-" + sc;

  let parts = [usage, type, country];
  if (da) parts.push(da);
  if (sa) parts.push(sa);
  if (en) parts.push(en);
  parts.push(version);

  const built = parts.join(".");
  document.getElementById("builderResult").innerHTML =
    parseTopic(built).validResult;
  return built;
}

function sendBuiltToValidator() {
  const t = buildTopic();
  document.getElementById("validatorInput").value = t;
  runValidation();
}

// ================================
// KEYBOARD SHORTCUTS
// ================================

document.addEventListener("keydown", (e) => {
  // Normalize (Cmd on Mac = Ctrl on Windows)
  const ctrl = e.ctrlKey || e.metaKey;

  // Validate (Ctrl + Enter)
  if (ctrl && e.key === "Enter") {
    e.preventDefault();
    sendBuiltToValidator();
  }

  // Copy built topic (Ctrl + C)
  if (ctrl && e.key.toLowerCase() === "c") {
    const txt = document.getElementById("builderResult").innerText;
    if (txt) {
      e.preventDefault();
      navigator.clipboard.writeText(txt);
      infoToast("copy: " + txt);
    }
  }

  // Focus validator input (Ctrl + L)
  if (ctrl && e.key.toLowerCase() === "l") {
    e.preventDefault();
    loadValidatorIntoBuilder();
  }

  // Focus validator input (Ctrl + E)
  if (ctrl && e.key.toLowerCase() === "e") {
    e.preventDefault();
    document.getElementById("validatorInput").focus();
  }
});

// ===============================================
// UTILS
// ===============================================

function rebuildDisplay(segment) {
  let fixes = segment.fixes.map((f) => "🛠️ " + f);

  if (!segment.value) {
    if (MANDATORY_SEGMENT_NAMES.includes(segment.name)) {
      return asErrorSpan(
        "_",
        segment.errors.map((e) => "‼️" + e).concat(fixes),
      );
    }
    return null;
  }

  if (segment.errors.length !== 0) {
    return asErrorSpan(
      segment.value,
      segment.errors.map((e) => "‼️" + e).concat(fixes),
    );
  }

  if (segment.warnings.length !== 0) {
    return asWarningSpan(
      segment.value,
      segment.warnings.map((w) => "⚠️" + w).concat(fixes),
    );
  }

  return segment.value;
}

function asWarningSpan(text, tooltips) {
  return (
    '<span style="text-decoration: underline wavy yellow;" title="' +
    tooltips.join("1&#10;") +
    '">' +
    text +
    "</span>"
  );
}

function asErrorSpan(text, tooltips) {
  return (
    '<span style="text-decoration: underline wavy red;" title="' +
    tooltips.join("1&#10;") +
    '">' +
    text +
    "</span>"
  );
}

function createMissplacedString(value, index) {
  return `(${index}) ${value}`;
}

function loadFromUri() {
  const topic = readParams(URI_TOPIC_PARAM_NAME);

  if (topic === null || topic === "" || topic === undefined) return;

  document.getElementById("validatorInput").value = topic;
  runValidation();
}

/* --------------------------------------------------------------------------
  Start page
--------------------------------------------------------------------------*/

// ================================
// REAL-TIME VALIDATION (DEBOUNCED)
// ================================

document.getElementById("validatorInput").addEventListener("input", () => {
  clearTimeout(validationDebounce);

  validationDebounce = setTimeout(() => {
    runValidation();
  }, 300); // 300ms after user stops typing
});

// CONCEPTS PANEL TOGGLE
document.getElementById("conceptsBtn").addEventListener("click", () => {
  document.getElementById("conceptPanel").classList.toggle("hidden");
});

// ShareButton
document.getElementById("shareBtn").addEventListener("click", () => {
  infoToast("copy: " + sharePage());
});

loadFromUri();
