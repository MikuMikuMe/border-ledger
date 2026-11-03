import { NativeModules } from 'react-native';

type NativeWealthFixtureModule = {
  getLaunchScene(): Promise<{ dark: boolean } | null>;
  pickCsv(): Promise<string | null>;
  saveDocument(content: string, fileName: string): Promise<boolean>;
};

const fixtureModule = NativeModules.NativeWealthFixture as NativeWealthFixtureModule | undefined;
const debugBuild = () => typeof __DEV__ !== 'undefined' && __DEV__;

function requireFixtureModule(): NativeWealthFixtureModule {
  if (!debugBuild() || !fixtureModule) throw new Error('The Wealth file fixture is available only in the .probe.wealthqa debug app.');
  return fixtureModule;
}

export const nativeWealthFixture = {
  getLaunchScene: async () => {
    if (!debugBuild() || !fixtureModule) return null;
    return fixtureModule.getLaunchScene();
  },
  pickCsv: () => requireFixtureModule().pickCsv(),
  saveDocument: (content: string, fileName: string) => requireFixtureModule().saveDocument(content, fileName),
};
