export interface XSession {
  userId: string | null;
  csrfToken: string | null;
}

export type XSessionProvider = () => Promise<XSession>;
