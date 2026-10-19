export interface AndroidAcceptanceOptions {
  manifestPath: string;
  evidenceDirectory: string;
  expectedSourceSha: string;
  expectedApkSha256: string;
  expectedSigningCertificateSha256: string;
  expectedVersionCode: number;
  fetchImpl?: typeof fetch;
}

export function verifyAndroidAcceptance(options: AndroidAcceptanceOptions): Promise<{
  verified: true;
  featureGateCount: 18;
}>;
