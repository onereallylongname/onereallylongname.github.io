// ===============================
// Levenshtein Distance
// ===============================

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix = [];

  // Initialize the first row and column
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  // Compute edits
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;

      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost, // substitution
      );
    }
  }

  return matrix[b.length][a.length];
}

function similarity(a, b) {
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

function bestMatch(word, list, minScore = 0.6) {
  let best = null;
  let bestScore = 0;

  for (const candidate of list) {
    const score = similarity(word, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  if (bestScore >= minScore) {
    return best;
  }

  return null;
}

/* ------------------------------
  | FUZZY SEARCH
   ----------------------------*/
// function fuzzy(str, pattern) {
//   if (!str || str === "") return false;
//   if (!pattern || pattern === "") return false;
//
//   var hay = str, // .toLowerCase(),
//     hayLower = str.toLowerCase(),
//     i = 0,
//     n = -1,
//     l;
//   pattern = pattern; //.toLowerCase();
//   for (; (l = pattern[i++]); )
//     if (
//       !~(n = Math.max(
//         hay.indexOf(l, n + 1),
//         hayLower.indexOf(l.toLowerCase(), n + 1),
//       ))
//     )
//       return false;
//   return true;
// }
function fuzzy(str, pattern) {
  if (!str || !pattern) return false;

  let i = 0; // index into pattern
  let j = 0; // index into string

  while (i < pattern.length && j < str.length) {
    // CamelCase boost: match if pattern char equals uppercase char
    if (pattern[i] === pattern[i].toUpperCase()) {
      if (str[j] === pattern[i]) {
        i++;
        j++;
        continue;
      }
    } else {
      // Normal case-insensitive match
      if (str[j].toLowerCase() === pattern[i].toLowerCase()) {
        i++;
        j++;
        continue;
      }
    }

    j++; // move forward in string
  }

  return i === pattern.length;
}
