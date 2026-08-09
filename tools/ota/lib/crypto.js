'use strict';
/*
 * EC P-256 (ECDSA / ES256) sign/verify for OTA manifests.
 *
 * CHANGED 2026-07-08: this was originally Ed25519 (see git history / README's
 * former "Known inconsistency" section). Confirmed via Microsoft Learn +
 * Azure/azure-cli#26898 that Azure Key Vault does NOT support Ed25519 at all
 * — supported curves are P-256/P-384/P-521/P-256K only, standard or Managed
 * HSM. The milestone-table heading in HARNESS-UPDATE-FRAMEWORK.md ("Azure Key
 * Vault EC P-256 signing") was correct; the doc body's Ed25519 references
 * were the error. Switched before any real manifest shipped — zero
 * back-compat cost.
 *
 * dsaEncoding is explicitly 'ieee-p1363' (raw fixed-length r||s), NOT the
 * Node default 'der'. This is deliberate: Azure Key Vault's `sign` operation
 * with algorithm ES256 returns a raw JOSE/JWS-style r||s signature, not DER.
 * Forcing ieee-p1363 here — even for the local dev key — means the exact
 * byte format this tool proves out today is the format production will
 * actually produce once signing moves to Key Vault. Only the key SOURCE
 * changes later (local PEM -> Key Vault sign() call); the signature format
 * and everything downstream (canonical-json, manifest schema, verify.js)
 * stays identical. Do not change this back to 'der' without re-testing
 * against a real Key Vault signature.
 */

const crypto = require('node:crypto');
const { signableBytes } = require('./canonical-json');

const DSA_ENCODING = 'ieee-p1363';

function generateKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

/** Returns a NEW manifest object with `signature` populated. Never mutates input. */
function signManifest(manifest, privateKeyPem) {
  const bytes = signableBytes(manifest);
  const signature = crypto.sign('sha256', Buffer.from(bytes, 'utf-8'), {
    key: privateKeyPem,
    dsaEncoding: DSA_ENCODING,
  });
  return { ...manifest, signature: signature.toString('base64') };
}

/** Returns true/false. Never throws on a bad signature — throws only on malformed input. */
function verifyManifest(manifest, publicKeyPem) {
  if (!manifest.signature) return false;
  const bytes = signableBytes(manifest);
  const sig = Buffer.from(manifest.signature, 'base64');
  return crypto.verify('sha256', Buffer.from(bytes, 'utf-8'), {
    key: publicKeyPem,
    dsaEncoding: DSA_ENCODING,
  }, sig);
}

module.exports = { generateKeypair, signManifest, verifyManifest };
