import crypto from 'node:crypto';

type ArtifactDownloadTokenPayload = {
  v: 1;
  orgId: string;
  userId: string;
  runId: string;
  artifactId: string;
  exp: number;
};

function getSigningKey(): string {
  const key = process.env.ENCRYPTION_KEY?.trim();
  if (!key) {
    throw new Error('ENCRYPTION_KEY is required for artifact download token signing');
  }
  return key;
}

function signPayload(segment: string): string {
  return crypto
    .createHmac('sha256', getSigningKey())
    .update(segment)
    .digest('base64url');
}

export function issueArtifactDownloadToken(input: {
  orgId: string;
  userId: string;
  runId: string;
  artifactId: string;
  expiresInSeconds: number;
}): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload: ArtifactDownloadTokenPayload = {
    v: 1,
    orgId: input.orgId,
    userId: input.userId,
    runId: input.runId,
    artifactId: input.artifactId,
    exp: nowSeconds + input.expiresInSeconds,
  };
  const payloadSegment = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = signPayload(payloadSegment);
  return `${payloadSegment}.${signature}`;
}

export function verifyArtifactDownloadToken(token: string): ArtifactDownloadTokenPayload {
  const [payloadSegment, signature] = token.split('.');
  if (!payloadSegment || !signature) {
    throw new Error('Invalid download token format');
  }

  const expectedSignature = signPayload(payloadSegment);
  const actualBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error('Invalid download token signature');
  }

  const payload = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8')) as Partial<ArtifactDownloadTokenPayload>;
  if (
    payload.v !== 1 ||
    !payload.orgId ||
    !payload.userId ||
    !payload.runId ||
    !payload.artifactId ||
    !payload.exp
  ) {
    throw new Error('Invalid download token payload');
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Download token expired');
  }
  return payload as ArtifactDownloadTokenPayload;
}
