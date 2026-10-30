import { z } from 'zod';
import type { Db } from '../db/types.ts';

export const authorSettingsSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(100),
  role: z.string().trim().max(120),
  bio: z.string().trim().max(600),
});
export type AuthorSettings = z.infer<typeof authorSettingsSchema>;

export const DEFAULT_AUTHOR: AuthorSettings = {
  name: 'Cynthia J Singh',
  role: 'Behavioural Skills Consultant & L&D Facilitator',
  bio: 'Cynthia helps L&D leaders build teams that communicate with clarity, lead with confidence and perform with impact.',
};

export class SettingsService {
  constructor(private readonly db: Db) {}

  async author(): Promise<AuthorSettings> {
    const { rows } = await this.db.query<{ value: unknown }>("SELECT value FROM settings WHERE key = 'author'");
    const parsed = authorSettingsSchema.safeParse(typeof rows[0]?.value === 'string' ? JSON.parse(rows[0].value) : rows[0]?.value);
    return parsed.success ? parsed.data : DEFAULT_AUTHOR;
  }

  async saveAuthor(raw: unknown): Promise<AuthorSettings> {
    const value = authorSettingsSchema.parse(raw);
    await this.db.query(
      `INSERT INTO settings (key, value) VALUES ('author', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(value)],
    );
    return value;
  }
}
