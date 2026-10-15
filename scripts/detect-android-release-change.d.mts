export interface AndroidReleaseChangeInput {
  eventName: string;
  changedPaths: string[];
  packageDiff?: string;
  packageBefore?: string;
  packageCurrent?: string;
  packageLockBefore?: string;
  packageLockCurrent?: string;
  frontendSource?: string;
}

export function shouldPublishAndroidRelease(input: AndroidReleaseChangeInput): boolean;
