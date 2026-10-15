export interface AndroidReleaseChangeInput {
  eventName: string;
  changedPaths: string[];
  packageDiff?: string;
}

export function shouldPublishAndroidRelease(input: AndroidReleaseChangeInput): boolean;
