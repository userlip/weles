// The parts of a browser page the credential capture reads: its pages, their
// frames, and the elements a credential may be shown in.

export type CredentialLocator = {
  count: () => Promise<number>;
  nth: (index: number) => {
    evaluate: <Value>(
      pageFunction: (element: Element) => Value,
    ) => Promise<Value>;
  };
};

export type CredentialFrame = {
  url: () => string;
  locator: (selector: string) => CredentialLocator;
  getByLabel: (text: string, options: { exact: boolean }) => CredentialLocator;
  getByRole: (role: string, options: { name: RegExp }) => CredentialLocator;
};

export type CredentialPage = {
  url: () => string;
  frames: () => CredentialFrame[];
  context?: () => { pages: () => CredentialPage[] };
};
