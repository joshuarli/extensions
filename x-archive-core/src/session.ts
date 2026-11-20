interface XSession {
  userId: string | null;
  csrfToken: string | null;
  cookieHeader?: string | undefined;
}

export type XSessionProvider = () => Promise<XSession>;
