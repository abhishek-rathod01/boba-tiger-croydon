/* Boba Tiger Hours Tracker — names.js
 *
 * Deterministic JS fuzzy-matching of a typed/AI-guessed name against the
 * active staff list. This is the backstop the spec calls for: the LLM may
 * suggest a name, but whether it resolves to a real person — and whether
 * that resolution is confident or ambiguous — is decided here in plain JS,
 * not by trusting the model's own confidence claim.
 *
 * Matching pipeline, in order, first hit wins:
 *   1. Exact match (case/whitespace/accent-insensitive).
 *   2. Prefix match — "pri" / "priy" against "Priya" (nickname/shorthand).
 *   3. Edit-distance match — typo tolerance ("Priyaa", "Pryia"), threshold
 *      scales with name length so short names aren't over-matched.
 * If more than one active staff member matches closely and no single
 * candidate is a clearly better fit, the result is "ambiguous" — the caller
 * must ask the user which person, never guess.
 */
(function (BT) {
  'use strict';

  // Unicode combining diacritical marks block (U+0300-U+036F), used to strip
  // accents after NFD decomposition (e.g. "Jose" + combining acute -> "Jose").
  // Built from numeric char codes at runtime, rather than an inline escape
  // literal in the source, to avoid any ambiguity in how this file is saved.
  var COMBINING_MARKS_RE = new RegExp(
    '[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g'
  );

  function normalize(str) {
    return String(str || '')
      .normalize('NFD').replace(COMBINING_MARKS_RE, '') // strip accents
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  // Optimal String Alignment distance: Levenshtein (insert/delete/substitute)
  // plus adjacent-transposition as a single edit. Plain Levenshtein scores a
  // swapped pair of letters ("Pryia" vs "Priya") as 2 edits, which pushes a
  // very common casual typo pattern outside our tolerance threshold; treating
  // it as 1 edit (like a human would) matches real typing mistakes better.
  function editDistance(a, b) {
    if (a === b) return 0;
    var al = a.length, bl = b.length;
    if (al === 0) return bl;
    if (bl === 0) return al;
    // Full (i x j) matrix is needed here (not the 2-row rolling version)
    // because transposition looks back two rows.
    var d = [];
    for (var i = 0; i <= al; i++) { d.push(new Array(bl + 1).fill(0)); d[i][0] = i; }
    for (var j = 0; j <= bl; j++) d[0][j] = j;
    for (i = 1; i <= al; i++) {
      for (j = 1; j <= bl; j++) {
        var cost = a[i - 1] === b[j - 1] ? 0 : 1;
        var best = Math.min(
          d[i - 1][j] + 1,      // deletion
          d[i][j - 1] + 1,      // insertion
          d[i - 1][j - 1] + cost // substitution
        );
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          best = Math.min(best, d[i - 2][j - 2] + 1); // adjacent transposition
        }
        d[i][j] = best;
      }
    }
    return d[al][bl];
  }

  // Max edit distance we'll tolerate as a "typo" match, scaled by name length.
  function typoThreshold(len) {
    if (len <= 3) return 0;   // very short names: only exact/prefix, no fuzz
    if (len <= 5) return 1;
    return 2;
  }

  // Score a candidate staff name against a normalized input. Higher is better.
  // Returns null if no match at all under the rules above.
  function scoreCandidate(inputNorm, nameNorm) {
    if (!inputNorm || !nameNorm) return null;
    if (inputNorm === nameNorm) return { kind: 'exact', score: 100 };

    // Prefix / nickname: input is a prefix of the name (min 2 chars).
    if (nameNorm.length >= 2 && inputNorm.length >= 2) {
      if (nameNorm.indexOf(inputNorm) === 0) {
        // Longer prefixes are more confident than very short ones.
        var prefixScore = 70 + Math.min(20, inputNorm.length * 3);
        return { kind: 'prefix', score: prefixScore };
      }
    }

    // Typo tolerance via edit distance, scaled to the name length.
    var dist = editDistance(inputNorm, nameNorm);
    var threshold = typoThreshold(nameNorm.length);
    if (dist <= threshold && dist > 0) {
      var typoScore = 60 - dist * 15;
      return { kind: 'typo', score: typoScore };
    }
    return null;
  }

  // matchStaffName(input, staffList)
  //   staffList: array of { id, name, active }
  // Returns:
  //   { status: 'matched', staffId, name, kind, score }
  //   { status: 'ambiguous', candidates: [{staffId, name, score}, ...] }
  //   { status: 'unknown' }
  function matchStaffName(input, staffList) {
    var inputNorm = normalize(input);
    if (!inputNorm) return { status: 'unknown' };

    var active = (staffList || []).filter(function (s) { return s.active !== false; });
    var scored = [];
    active.forEach(function (s) {
      var nameNorm = normalize(s.name);
      var result = scoreCandidate(inputNorm, nameNorm);
      if (result) {
        scored.push({ staffId: s.id, name: s.name, kind: result.kind, score: result.score });
      }
    });

    if (scored.length === 0) return { status: 'unknown' };

    scored.sort(function (a, b) { return b.score - a.score; });

    // Unambiguous if there's a single best, or the top score clearly beats
    // the runner-up (10+ point gap) — otherwise ask which person.
    if (scored.length === 1 || (scored[0].score - scored[1].score) >= 10) {
      var top = scored[0];
      return { status: 'matched', staffId: top.staffId, name: top.name, kind: top.kind, score: top.score };
    }

    // Close race between two or more candidates — genuine ambiguity.
    var tieScore = scored[0].score;
    var candidates = scored.filter(function (c) { return tieScore - c.score < 10; });
    return { status: 'ambiguous', candidates: candidates };
  }

  // Simple, deterministic detector for self-reference ("I worked 9 to 5").
  // Looks for first-person pronouns as whole words, case-insensitively.
  // Deliberately conservative (word-boundary match) to avoid false hits on
  // names/words that merely contain "i" or "me".
  function containsSelfReference(text) {
    return /\b(i|i'm|im|me|my|myself)\b/i.test(String(text || ''));
  }

  BT.names = {
    normalize: normalize,
    editDistance: editDistance,
    matchStaffName: matchStaffName,
    containsSelfReference: containsSelfReference
  };
})(window.BT = window.BT || {});
