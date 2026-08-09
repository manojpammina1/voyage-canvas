# Titan Config Reference

GENERATED FILE — do not hand-edit. Produced by `harness/scripts/gen-config-reference.py` from `harness/titan.config.schema.json`. Re-run the generator and commit the output after any schema change.

Schema: `titan.config.schema.json` — Single source of truth an adopter edits. Everything else (CLAUDE.md, data/*.json, settings.json deny list, hook pattern lists) is generated or read from this file. See docs/CONFIG-REFERENCE.md.

See `docs/ADOPTION.md` for the minimum set of keys to fill in before a first deploy, and `harness/titan.config.example.json` for a fully filled worked example.

| Key path | Type | Required (at its level) | Enum / notes | Description |
|---|---|---|---|---|
| `configured` | boolean | yes | — | false ships in the placeholder config; SessionStart warns loudly until an adopter flips this to true. |
| `org` | object | yes | — | — |
| `org.name` | string | yes | — | — |
| `org.short_name` | string | yes | — | — |
| `org.display_name` | string | yes | — | — |
| `org.email_domain` | string | yes | — | — |
| `org.harness_brand` | string | yes | — | e.g. "Titan" — used in banners/log prefixes |
| `org.workspace_note` | string | no | — | — |
| `contacts` | object | yes | — | — |
| `contacts.people` | object | yes | — | id -> person/group. The only place a human name appears. |
| `contacts.areas` | object | yes | — | area key (ui, aem, commerce, cif, search, pim, cicd, security, architecture, ...) -> owners |
| `roles` | object | yes | — | — |
| `roles.governance_owner` | string | yes | — | contacts.people id — only role allowed to edit .claude/ and CLAUDE.md |
| `roles.definitions` | object | yes | — | — |
| `modes` | object | yes | — | — |
| `modes.active` | array<string> | yes | — | — |
| `modes.hidden` | array<string> | no | — | — |
| `modes.require_mode_before_work` | boolean | yes | — | — |
| `stack` | object | no | — | — |
| `stack.aem` | object | no | — | — |
| `stack.aem.enabled` | boolean | no | — | — |
| `stack.aem.flavour` | string | no | `aemaacs`, `local-sdk`, `legacy-cq` | — |
| `stack.aem.cloud_manager` | boolean | no | — | — |
| `stack.aem.legacy_cq` | boolean | no | — | — |
| `stack.aem.local_sdk` | boolean | no | — | — |
| `stack.commerce` | object | no | — | — |
| `stack.commerce.enabled` | boolean | no | — | — |
| `stack.commerce.platform` | string | no | — | — |
| `stack.commerce.occ` | boolean | no | — | — |
| `stack.cif` | object | no | — | — |
| `stack.cif.enabled` | boolean | no | — | — |
| `stack.cif.graphql` | boolean | no | — | — |
| `stack.cif.lerna` | boolean | no | — | — |
| `stack.search` | object | no | — | — |
| `stack.search.enabled` | boolean | no | — | — |
| `stack.search.providers` | array<string> | no | — | — |
| `stack.frontend` | object | no | — | — |
| `stack.frontend.react` | boolean | no | — | — |
| `stack.frontend.redux_patterns` | array<string> | no | — | — |
| `stack.frontend.stylesheets` | array<string> | no | — | — |
| `stack.i18n` | boolean | no | — | — |
| `repos` | array<object> | no | — | — |
| `repos[].id` | string | yes | — | — |
| `repos[].dir` | string | yes | — | — |
| `repos[].display` | string | yes | — | — |
| `repos[].kind` | string | yes | `aem-maven`, `node-lerna`, `hybris`, `generic` | — |
| `repos[].role_in_stack` | array<string> | no | — | — |
| `repos[].module_naming` | array<string> | no | — | — |
| `repos[].risk_notes` | array<string> | no | — | — |
| `repos[].default_reviewers` | array<string> | no | — | — |
| `repos[].extra_reviewer_rules` | array<object> | no | — | — |
| `repos[].branches` | object | no | — | — |
| `repos[].branches.base` | string | no | — | — |
| `repos[].branches.release_pattern` | string | no | — | — |
| `protected_paths` | array<object> | yes | — | The reconciliation point. All secret/hard-stop path lists across the harness generate from this array. |
| `protected_paths[].id` | string | yes | — | — |
| `protected_paths[].globs` | array<string> | no | — | — |
| `protected_paths[].command_patterns` | array<string> | no | — | verbatim regex: entries for shapes not expressible as globs, e.g. "regex:openssl\\s+pkcs12" |
| `protected_paths[].reader_guard_dirs` | array<string> | no | — | — |
| `protected_paths[].severity` | string | yes | `CRITICAL`, `HIGH`, `MODERATE`, `LOW-MODERATE`, `LOW` | — |
| `protected_paths[].rotatable` | boolean | no | — | — |
| `protected_paths[].owners` | array<string> | yes | — | contacts.people ids |
| `protected_paths[].why` | string | yes | — | — |
| `protected_paths[].enforcement` | object | yes | — | — |
| `protected_paths[].enforcement.block_read` | boolean | no | — | — |
| `protected_paths[].enforcement.block_write` | boolean | no | — | — |
| `protected_paths[].enforcement.block_bash` | boolean | no | — | — |
| `protected_paths[].enforcement.block_grep` | boolean | no | — | — |
| `protected_paths[].enforcement.block_prompt` | boolean | no | — | — |
| `protected_paths[].enforcement.never_index` | boolean | no | — | — |
| `protected_paths[].enforcement.deny_in_settings` | boolean | no | — | — |
| `protected_paths[].enforcement.hard_stop` | boolean | no | — | — |
| `protected_paths[].enforcement.escalate_on_touch` | boolean | no | — | — |
| `protected_paths[].message` | string | no | — | — |
| `contracts` | array<object> | no | — | — |
| `contracts[].name` | string | yes | — | — |
| `contracts[].owner_repo` | string | yes | — | — |
| `contracts[].consumer_repos` | array<string> | yes | — | — |
| `contracts[].owners` | array<string> | yes | — | — |
| `environments` | object | no | — | — |
| `platforms` | object | no | — | — |
| `platforms.scm` | object | no | — | — |
| `platforms.scm.kind` | string | no | `azure-devops`, `github` | — |
| `platforms.scm.base_url` | string | no | — | — |
| `platforms.scm.collection` | string | no | — | — |
| `platforms.scm.pat_url` | string | no | — | — |
| `platforms.issue_tracker` | object | no | — | — |
| `platforms.issue_tracker.kind` | string | no | `jira`, `none` | — |
| `platforms.issue_tracker.site` | string | no | — | — |
| `platforms.issue_tracker.ticket_regex` | string | no | — | — |
| `platforms.general_chat_alternative` | string | no | — | — |
| `governance` | object | no | — | — |
| `governance.locked_paths` | array<string> | no | — | — |
| `governance.plugin_policy` | object | no | — | — |
| `governance.plugin_policy.approved` | array<string> | no | — | — |
| `governance.plugin_policy.pending` | array<string> | no | — | — |
| `governance.plugin_policy.blocked` | array<string> | no | — | — |
| `telemetry` | object | yes | — | — |
| `telemetry.salt` | string | yes | — | — |
| `telemetry.enabled` | boolean | yes | — | — |
| `telemetry.upload` | object | no | — | — |
| `telemetry.upload.kind` | string | no | `none`, `azure-blob` | — |
| `data_files` | object | yes | — | — |
| `data_files.build_map` | string | yes | — | — |
| `data_files.reviewer_map` | string | yes | — | — |
| `data_files.known_issues` | string | yes | — | — |
| `data_files.protected_paths` | string | yes | — | — |
| `docs` | object | no | — | — |
| `branding` | object | no | — | Adopter-supplied visual identity — additive, optional field, added in Phase 6 step 23 of the Titan extraction. Ships defaulted to the neutral Titan mark so an unconfigured install still renders something instead of a broken image reference. See docs/CONFIG-REFERENCE.md. |
| `branding.logo_path` | string | no | — | Path (relative to the app's assets dir) to an SVG/PNG logo. Default: assets/titan-mark.svg. |
| `branding.product_name` | string | no | — | Displayed in the wizard header, Dashboard header, and dashboard analytics header. Default: "Titan". |
| `branding.accent` | string | no | — | Primary accent hex color, e.g. "#2F6FED". Intended to eventually drive the ds-blue-main Tailwind token at render/build time. |
