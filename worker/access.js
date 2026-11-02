const TEAM_DOMAIN = 'abbasbitar68.cloudflareaccess.com';
const ISSUER = `https://${TEAM_DOMAIN}`;
const CERTS_URL = `${ISSUER}/cdn-cgi/access/certs`;

function decodeBase64Url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('Invalid JWT encoding');
  }

  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(
    atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')),
    c => c.charCodeAt(0)
  );
}

function decodeJSON(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}


const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
let cachedKeys = null;
let cacheExpiresAt = 0;
let pendingRefresh = null;

async function refreshSigningKeys() {
  if (!pendingRefresh) {
    pendingRefresh = (async () => {
      const response = await fetch(CERTS_URL, {
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) throw new Error('JWKS unavailable');

      const certificates = await response.json();

      if (!Array.isArray(certificates.keys)) {
        throw new Error('Invalid JWKS response');
      }

      const keys = certificates.keys.filter(
        key => key &&
               key.kty === 'RSA' &&
               key.alg === 'RS256' &&
               typeof key.kid === 'string'
      );

      if (keys.length === 0) {
        throw new Error('No valid signing keys');
      }

      cachedKeys = keys;
      cacheExpiresAt = Date.now() + JWKS_CACHE_TTL_MS;

      return keys;
    })().finally(() => {
      pendingRefresh = null;
    });
  }

  return pendingRefresh;
}

async function getSigningKey(kid) {
  let keys;

  if (cachedKeys && Date.now() < cacheExpiresAt) {
    keys = cachedKeys;
  } else {
    keys = await refreshSigningKeys();
  }

  let key = keys.find(candidate => candidate.kid === kid);

  // Refresh once if Cloudflare has rotated its signing keys.
  if (!key && cachedKeys && Date.now() < cacheExpiresAt) {
    keys = await refreshSigningKeys();
    key = keys.find(candidate => candidate.kid === kid);
  }

  return key || null;
}
export async function verifyAccessJWT(token, audience) {
  if (
    typeof token !== 'string' ||
    token.length > 8192 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
  ) {
    return false;
  }

  if (typeof audience !== 'string' || !audience) return false;

  try {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
    const header = decodeJSON(encodedHeader);
    const payload = decodeJSON(encodedPayload);

    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return false;
    if (payload.iss !== ISSUER) return false;
    if (!Array.isArray(payload.aud) || !payload.aud.includes(audience)) return false;

    const now = Math.floor(Date.now() / 1000);

    if (!Number.isSafeInteger(payload.exp) || payload.exp <= now) return false;
    if (!Number.isSafeInteger(payload.iat) ||
        payload.iat > now + 60 ||
        payload.iat >= payload.exp) return false;
    if (payload.nbf !== undefined &&
        (!Number.isSafeInteger(payload.nbf) || payload.nbf > now)) return false;

    const jwk = await getSigningKey(header.kid);

    if (!jwk) return false;

    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const signature = decodeBase64Url(encodedSignature);
    const signedData = new TextEncoder().encode(
      `${encodedHeader}.${encodedPayload}`
    );

    return await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      signature,
      signedData
    );
  } catch {
    return false;
  }
}

export function getAccessToken(request) {
  const header = request.headers.get('Cf-Access-Jwt-Assertion');

  if (header) return header;

  const cookieHeader = request.headers.get('Cookie') || '';

  for (const cookie of cookieHeader.split(';')) {
    const separator = cookie.indexOf('=');
    if (separator < 0) continue;

    const name = cookie.slice(0, separator).trim();
    const value = cookie.slice(separator + 1).trim();

    if (name === 'CF_Authorization') {
      return value;
    }
  }

  return null;
}
export async function authorizeAccess(token, audience, approvedEmails) {
  if (!await verifyAccessJWT(token, audience)) {
    return false;
  }

  if (typeof approvedEmails !== 'string' || !approvedEmails.trim()) {
    return false;
  }

  try {
    const payload = decodeJSON(token.split('.')[1]);

    if (typeof payload.email !== 'string') {
      return false;
    }

    const email = payload.email.trim().toLowerCase();

    const allowlist = approvedEmails
      .split(',')
      .map(value => value.trim().toLowerCase())
      .filter(Boolean);

    return allowlist.includes(email);
  } catch {
    return false;
  }
}