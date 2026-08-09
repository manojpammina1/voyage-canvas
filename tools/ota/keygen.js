#!/usr/bin/env node
'use strict';
/*
 * Titan OTA — DEV/TEST keypair generator.
 *
 * NOT FOR PRODUCTION. docs/HARNESS-UPDATE.md names signing-key
 * compromise as the single biggest residual risk of this whole system — the
 * production private key must live in Azure Key Vault / HSM and never touch
 * a developer's disk (sec 3a). This script exists only so M1's manifest/
 * sign/verify round trip can be built and tested before Key Vault wiring
 * (a separate infra task owned by the toolkit maintainer + Security) exists.
 *
 * Usage:
 *   node tools/ota/keygen.js
 *
 * Writes (both gitignored — see .gitignore "tools/ota/.devkeys/"):
 *   tools/ota/.devkeys/dev-signing.private.key   (PKCS8 PEM — NEVER commit, NEVER ship)
 *   tools/ota/.devkeys/dev-signing.public.pem    (SPKI PEM — this is what gets
 *     embedded in the client as the trust anchor; still dev-only until a real
 *     Key Vault key replaces it)
 */

const fs = require('node:fs');
const path = require('node:path');
const { generateKeypair } = require('./lib/crypto');

const OUT_DIR = path.join(__dirname, '.devkeys');
const PRIV_PATH = path.join(OUT_DIR, 'dev-signing.private.key');
const PUB_PATH = path.join(OUT_DIR, 'dev-signing.public.pem');

if (fs.existsSync(PRIV_PATH)) {
  console.error(`Refusing to overwrite existing dev key: ${PRIV_PATH}`);
  console.error('Delete it manually first if you intend to rotate the dev/test key.');
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const { publicKeyPem, privateKeyPem } = generateKeypair();
fs.writeFileSync(PRIV_PATH, privateKeyPem, { mode: 0o600 });
fs.writeFileSync(PUB_PATH, publicKeyPem, { mode: 0o644 });

console.log('DEV/TEST EC P-256 keypair generated (NOT for production signing):');
console.log(`  private: ${PRIV_PATH}`);
console.log(`  public:  ${PUB_PATH}`);
console.log('\nBefore first real release: move key custody to Azure Key Vault / HSM');
console.log('(docs/HARNESS-UPDATE.md — owner: the toolkit maintainer + Security).');
