/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** Set by middleware on /admin and /api/admin routes when signed in. */
    session: import('./server/auth/service.ts').AuthenticatedSession | null;
    csrfToken?: string;
  }
}
