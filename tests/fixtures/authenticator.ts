// A software WebAuthn authenticator for tests: it holds a real P-256 key pair and produces
// registration and authentication responses byte-for-byte as a phone's platform authenticator
// would (attestation "none", COSE ES256 public key, DER ECDSA signatures). The flags say whether
// user verification (the phone's fingerprint, face or PIN check) took place.
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

function cborHead(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  if (n < 65536) return Buffer.from([(major << 5) | 25, n >> 8, n & 0xff]);
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(n, 1);
  return b;
}
type Cbor = number | string | Buffer | Map<Cbor, Cbor>;
function cbor(v: Cbor): Buffer {
  if (typeof v === 'number') return v >= 0 ? cborHead(0, v) : cborHead(1, -1 - v);
  if (typeof v === 'string') {
    const s = Buffer.from(v, 'utf8');
    return Buffer.concat([cborHead(3, s.length), s]);
  }
  if (Buffer.isBuffer(v)) return Buffer.concat([cborHead(2, v.length), v]);
  const parts: Buffer[] = [cborHead(5, v.size)];
  for (const [k, val] of v) parts.push(cbor(k), cbor(val));
  return Buffer.concat(parts);
}

const b64u = (b: Buffer) => b.toString('base64url');

export interface Options {
  challenge: string;
}

export class SoftAuthenticator {
  readonly credentialId = randomBytes(32);
  private readonly privateKey: KeyObject;
  private readonly publicJwk: { x: string; y: string };
  counter = 0;

  constructor(
    readonly rpId: string,
    readonly origin: string,
  ) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = privateKey;
    this.publicJwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  }

  private authData(flags: number, attested?: Buffer, rpId = this.rpId): Buffer {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(this.counter);
    return Buffer.concat([createHash('sha256').update(rpId).digest(), Buffer.from([flags]), count, attested ?? Buffer.alloc(0)]);
  }

  private clientData(type: string, challenge: string, origin = this.origin): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8');
  }

  /** navigator.credentials.create() */
  register(options: Options, opts: { userVerified?: boolean; origin?: string; rpId?: string } = {}) {
    const coseKey = new Map<Cbor, Cbor>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(this.publicJwk.x, 'base64url')],
      [-3, Buffer.from(this.publicJwk.y, 'base64url')],
    ]);
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(this.credentialId.length);
    const attested = Buffer.concat([Buffer.alloc(16), idLen, this.credentialId, cbor(coseKey)]);
    const flags = 0x01 | (opts.userVerified === false ? 0 : 0x04) | 0x40;
    const attestationObject = cbor(
      new Map<Cbor, Cbor>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', this.authData(flags, attested, opts.rpId)],
      ]),
    );
    return {
      id: b64u(this.credentialId),
      rawId: b64u(this.credentialId),
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64u(this.clientData('webauthn.create', options.challenge, opts.origin)),
        attestationObject: b64u(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform' as const,
    };
  }

  /** navigator.credentials.get() */
  assert(options: Options, opts: { userVerified?: boolean; origin?: string; rpId?: string; tamper?: boolean; keepCounter?: boolean } = {}) {
    if (!opts.keepCounter) this.counter++;
    const authenticatorData = this.authData(0x01 | (opts.userVerified === false ? 0 : 0x04), undefined, opts.rpId);
    const clientDataJSON = this.clientData('webauthn.get', options.challenge, opts.origin);
    const signed = Buffer.concat([authenticatorData, createHash('sha256').update(clientDataJSON).digest()]);
    const signature = sign('sha256', signed, this.privateKey);
    if (opts.tamper) signature[signature.length - 1] = signature[signature.length - 1]! ^ 0xff;
    return {
      id: b64u(this.credentialId),
      rawId: b64u(this.credentialId),
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64u(clientDataJSON),
        authenticatorData: b64u(authenticatorData),
        signature: b64u(signature),
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform' as const,
    };
  }
}
