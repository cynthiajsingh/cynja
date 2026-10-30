import { AuthService } from './auth/service.ts';
import { env, mediaStorageKind } from './config.ts';
import { getDb } from './db/index.ts';
import type { Db } from './db/types.ts';
import { MediaService } from './media/service.ts';
import { LocalFsStorage, NetlifyBlobsStorage, type MediaStorage } from './media/storage.ts';
import { PostService } from './posts/service.ts';
import { SettingsService } from './settings/service.ts';
import { TaxonomyService } from './taxonomy/service.ts';

export interface Services {
  db: Db;
  auth: AuthService;
  posts: PostService;
  taxonomy: TaxonomyService;
  media: MediaService;
  settings: SettingsService;
}

/** Wires the use-case services to their dependencies. Tests pass an in-memory db and storage. */
export function createServices(deps: { db: Db; storage: MediaStorage; siteOrigin: string }): Services {
  const taxonomy = new TaxonomyService(deps.db);
  return {
    db: deps.db,
    auth: new AuthService(deps.db),
    posts: new PostService(deps.db, taxonomy, deps.siteOrigin),
    taxonomy,
    media: new MediaService(deps.db, deps.storage),
    settings: new SettingsService(deps.db),
  };
}

export function siteOrigin(): string {
  return env('SITE_URL') ?? env('URL') ?? 'https://cynja.in';
}

let services: Promise<Services> | undefined;

export function getServices(): Promise<Services> {
  services ??= getDb()
    .then((db) => createServices({
      db,
      storage: mediaStorageKind() === 'local' ? new LocalFsStorage() : new NetlifyBlobsStorage(),
      siteOrigin: siteOrigin(),
    }))
    .catch((err) => {
      services = undefined;
      throw err;
    });
  return services;
}
