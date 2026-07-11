declare module 'cloudflare:email' {
  export class EmailMessage {
    constructor(from: string, to: string, raw: string | Uint8Array);
  }
}

// ─── BitsNotes App Locals (populated by middleware) ─────────────────────────
interface AppUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: string;
}

interface AppLocals {
  user: AppUser | null;
  tier: string;
}

declare namespace App {
  interface Locals extends AppLocals {}
}
