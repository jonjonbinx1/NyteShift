# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in NyteShift, please **do not open a public GitHub issue**.  
Email the maintainers directly at the address listed in [CODEOWNERS](./CODEOWNERS). We aim to acknowledge reports within 72 hours and will coordinate a fix and disclosure timeline with you.

---

## Secret Storage

NyteShift stores all sensitive credentials (API keys, OAuth tokens, bot tokens) in an **encrypted local secret store** at `~/.nyteshift/secrets.json`.  Secrets are encrypted with AES-256-GCM. The encryption key lives in a separate file (`~/.nyteshift/.keyfile`) so that a leak of `secrets.json` alone is computationally insufficient to decrypt the contents.

Secrets are **never written to `config.json`** — any plaintext credentials detected in `config.json` on first read are automatically migrated to the secret store and removed from the JSON file.

Well-behaved marketplace tools declare their sensitive configuration fields with `type: "secret"` in their contract, which causes NyteShift to automatically route those values through the secret store rather than persisting them in plaintext.

---

## Marketplace & Tool Code Execution

> **Current model:** tool code runs without sandboxing.

NyteShift's marketplace allows users to install third-party tools and skills by downloading JavaScript modules from GitHub repositories.  These modules are executed directly in the same Node.js process as the host application.

**Why this is currently safe for the official marketplace:**  
The official NyteShift marketplace repository is a *managed repository* maintained by the project's core team under [CODEOWNERS](./CODEOWNERS) review. Every tool and skill submitted to the official marketplace is reviewed before merging. This mitigates the risk of malicious code being distributed through the official channel.

**What this means for you:**

- Only install tools from the **official marketplace repository** or from sources you personally trust and have audited.
- Adding a third-party or community marketplace source grants that source the ability to run arbitrary code on your machine. Treat it the same as installing any other software package.
- Do not add untrusted marketplace sources in production or sensitive environments.

**Future work — sandboxing:**  
Sandboxing for tool execution is on the roadmap. Once an appropriate sandboxing strategy has been evaluated, developed, and tested (e.g. via isolated VM worker threads or a restricted subprocess model), it will be enabled to provide defence-in-depth even for tools from trusted sources. This work will be tracked in a dedicated issue.

---

## Marketplace Download Integrity

Currently, marketplace items are downloaded from GitHub over HTTPS. HTTPS transport ensures the download is not tampered with in transit, but there is no additional checksum or cryptographic signature verification of downloaded files at the application level.

**Future work — checksum validation:**  
Per-file checksum validation of marketplace downloads will be added in a future release. This will allow the application to verify the integrity of downloaded tool and skill files against hashes published in the marketplace index, providing protection against supply-chain compromises even if the source repository is tampered with after review.

---

## Webhook Server

When webhook triggers are in use, NyteShift starts a local HTTP server that **binds to `127.0.0.1`** (localhost only) by default. It is not exposed to external networks unless you explicitly place a reverse proxy in front of it.

If you need to expose the webhook endpoint externally, use a properly configured reverse proxy (e.g. nginx, Caddy) with TLS termination, and protect the endpoint with a webhook HMAC secret configured on the trigger definition.

---

## Dependency Security

NyteShift uses Node.js and standard npm packages. Keep your dependencies up to date by running:

```sh
npm audit
npm update
```

Report any vulnerable transitive dependencies via the vulnerability disclosure process above.
