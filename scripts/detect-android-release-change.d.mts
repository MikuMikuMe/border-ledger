export interface AndroidReleaseChangeInput {
  eventName: string;
  changedPaths: string[];
  packageDiff?: string;
  packageBefore?: string;
  packageCurrent?: string;
  frontendSource?: string;
}

export function shouldPublishAndroidRelease(input: AndroidReleaseChangeInput): boolean;
