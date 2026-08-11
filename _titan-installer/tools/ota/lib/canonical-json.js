'use strict';
/*
 * Deterministic JSON serialization for signing.
 *
 * WHY THIS EXISTS: Ed25519 signs raw bytes. If the signer and verifier
 * serialize the same manifest object with different key ordering (which
 * plain JSON.stringify does not guarantee across Node versions/engines),
 * the byte streams differ and every signature "mismatches" even though the
 * data is identical. Canonicalizing (recursively sort object keys, no
 * whitespace) makes the signed bytes a pure function of the data, not of
 * insertion order. Both sign.js and verify.js MUST use this same function
 * on the same manifest-minus-signature shape, or verification will fail.
 */

function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  const body = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',');
  return `{${body}}`;
}

/** Returns the exact byte string that gets signed/verified for a manifest:
 *  the full manifest object with the "signature" field removed. */
function signableBytes(manifest) {
  const { signature, ...rest } = manifest;
  return canonicalize(rest);
}

module.exports = { canonicalize, signableBytes };
