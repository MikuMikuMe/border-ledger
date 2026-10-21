export interface AndroidReleaseVersion {
  versionName: string;
  versionCode: number;
  previousTagName: string;
}

export declare function resolveNextAndroidReleaseVersion(
  tags: string[],
  runNumber: number,
): AndroidReleaseVersion;
