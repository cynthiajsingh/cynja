import { tmpdir } from 'node:os';
import path from 'node:path';

// E2E data lives in the OS temp folder (not the project, which may be synced by
// OneDrive/Dropbox and get files locked mid-run). Each run gets a fresh folder.
export const E2E_ROOT = path.join(tmpdir(), 'cynja-e2e');
export const E2E_DIR = process.env.LOCAL_DATA_DIR ?? path.join(E2E_ROOT, 'current');
export const CREDS_FILE = path.join(E2E_ROOT, 'admin.json');
