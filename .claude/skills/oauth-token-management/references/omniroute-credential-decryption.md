# OmniRoute Field Encryption & Decryption Troubleshooting Reference

This document explains the encryption mechanics used by OmniRoute to secure database credentials, API keys, and OAuth2 tokens in SQLite, and provides diagnostic patterns for decryption failures.

## Encryption Architecture

OmniRoute secures sensitive provider fields (like `api_key`, `access_token`, `refresh_token`, and `id_token` inside the `provider_connections` table) using a secure symmetric cipher.

- **Cipher Algorithm:** `aes-256-gcm`
- **Output Format:** Prefix-formatted string: `enc:v1:<iv_hex>:<ciphertext_hex>:<auth_tag_hex>`
- **Key Derivation Function:** `scryptSync` (from Node.js `crypto` module)
  - **Salt:** `"omniroute-field-encryption-v1"`
  - **Key Length:** 32 bytes (256 bits)
  - **Source Material:** The master key `STORAGE_ENCRYPTION_KEY` (64-character hex string)

---

## The Node.js Decryption Algorithm

When troubleshooting decryption errors or migrating databases between Windows and WSL/Dev environments, the following verified Node.js script can be used to validate the `STORAGE_ENCRYPTION_KEY` and decrypt credentials:

```javascript
const crypto = require('crypto');

/**
 * Decrypts an OmniRoute enc:v1 formatted field
 * @param {string} encryptedText - The encrypted field from sqlite (e.g. enc:v1:...)
 * @param {string} masterKey - The 64-character hex STORAGE_ENCRYPTION_KEY
 * @returns {string|null} The decrypted plaintext string, or null if decryption fails
 */
function decryptField(encryptedText, masterKey) {
  if (!encryptedText || !encryptedText.startsWith('enc:v1:')) {
    return encryptedText; // Already plaintext or empty
  }

  const parts = encryptedText.slice(7).split(':');
  if (parts.length !== 3) {
    console.error("Malformed encrypted value structure.");
    return null;
  }

  const [ivHex, ctHex, tagHex] = parts;
  try {
    // Derive the cryptographic key using scryptSync
    const derivedKey = crypto.scryptSync(masterKey, "omniroute-field-encryption-v1", 32);
    
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const ct = Buffer.from(ctHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(ct, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error("Decryption failed:", err.message);
    return null;
  }
}
```

---

## The Python Decryption Algorithm

When running Python-based microservices, cron-jobs, or agentic tools inside WSL/Linux, the following verified Python script can be used to query the OmniRoute SQLite database and decrypt credentials:

```python
import sqlite3
import hashlib
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

def decrypt_field(encrypted_text: str, master_key: str) -> str:
    """
    Decrypts an OmniRoute enc:v1 formatted field.
    Requires: pip install cryptography
    """
    if not encrypted_text or not encrypted_text.startswith("enc:v1:"):
        return encrypted_text  # Already plaintext or empty

    parts = encrypted_text[7:].split(":")
    if len(parts) != 3:
        raise ValueError("Malformed encrypted value structure.")

    iv_hex, ct_hex, tag_hex = parts
    iv = bytes.fromhex(iv_hex)
    ct = bytes.fromhex(ct_hex)
    tag = bytes.fromhex(tag_hex)

    # Derive key matching Node's scryptSync(master_key, "omniroute-field-encryption-v1", 32)
    # n=16384 (2^14), r=8, p=1 are Node.js crypto's default scrypt limits
    derived_key = hashlib.scrypt(
        password=master_key.encode("utf-8"),
        salt=b"omniroute-field-encryption-v1",
        n=16384,
        r=8,
        p=1,
        dklen=32
    )

    # AES-GCM decryption in python cryptography library expects combined ciphertext + tag
    aesgcm = AESGCM(derived_key)
    try:
        decrypted = aesgcm.decrypt(iv, ct + tag, None)
        return decrypted.decode("utf-8")
    except Exception as e:
        print(f"Decryption failed: {e}")
        return None
```

---

## Crucial Troubleshooting Patterns

### 1. The Global npm `.env` Resolution Pitfall
On Windows environments, the active `STORAGE_ENCRYPTION_KEY` may **not** be resolved from the user's home directory (`C:\Users\<username>\.omniroute\.env`). Instead, because of how node global runner scripts execute, it may load from the active running app directory within the global node modules folder:
`C:\Users\<username>\AppData\Roaming\npm\node_modules\omniroute\app\.env`

Always check the global module directory first if the key in the user's home directory is generic or empty.

### 2. Mismatched Key Symptoms
If `STORAGE_ENCRYPTION_KEY` is wrong or missing on the target host (e.g. during a database migration from WSL/Windows to a Linux Dev/Prod server):
- The frontend panel will show empty/unpopulated provider connection forms.
- The logs will print warnings: `[Encryption] Found encrypted data but STORAGE_ENCRYPTION_KEY is not set. Cannot decrypt.` or `Decryption failed`.
- APIs attempting to make proxied calls with encrypted credentials will fail with authentication or missing key errors.
