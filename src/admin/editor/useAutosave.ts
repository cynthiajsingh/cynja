import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminPost } from '../../server/posts/types.ts';
import { api, ApiError } from '../api.ts';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

const DEBOUNCE_MS = 1500;
const RETRY_MS = [3000, 10_000, 30_000, 60_000];

/**
 * Debounced autosave with optimistic concurrency.
 * - Never runs two saves at once; edits made during a save trigger another save.
 * - Sends the revision the edits were based on; a 409 stops autosave ("conflict")
 *   instead of overwriting newer server content.
 * - "Saved" is only shown after the server confirms.
 */
export function useAutosave(opts: {
  postId: string;
  initialRevision: number;
  getPayload: () => Record<string, unknown>;
  onSaved: (post: AdminPost) => void;
}) {
  const [state, setState] = useState<SaveState>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const revision = useRef(opts.initialRevision);
  const version = useRef(0);
  const savedVersion = useRef(0);
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));
  const timer = useRef<number>(undefined);
  const retries = useRef(0);
  const stateRef = useRef<SaveState>('saved');
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const set = (s: SaveState) => { stateRef.current = s; setState(s); };

  // All saves go through one promise chain, so two PUTs never race each other.
  const run = useCallback((): Promise<boolean> => {
    const next = queue.current.then(() => saveOnce());
    queue.current = next.catch(() => false);
    return next;
  }, []);

  const saveOnce = async (): Promise<boolean> => {
    if (suspended.current) return false;
    if (stateRef.current === 'conflict') return false;
    if (version.current === savedVersion.current && stateRef.current !== 'error') return true;

    const v = version.current;
    set('saving');
    {
      try {
        const post = await api.put<AdminPost>(`/api/admin/posts/${optsRef.current.postId}`, {
          ...optsRef.current.getPayload(),
          revision: revision.current,
        });
        revision.current = post.revision;
        savedVersion.current = v;
        retries.current = 0;
        setError(null);
        setLastSavedAt(new Date());
        optsRef.current.onSaved(post);
        if (version.current === v) set('saved');
        else {
          set('dirty');
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => void run(), DEBOUNCE_MS);
        }
        return true;
      } catch (err) {
        const e = err instanceof ApiError ? err : new ApiError(0, 'unknown', 'Save failed.');
        setError(e);
        if (e.status === 409) {
          set('conflict');
        } else {
          set('error');
          // Transient failures retry automatically; validation errors wait for the next edit.
          if (e.status === 0 || e.status >= 500) {
            const delay = RETRY_MS[Math.min(retries.current++, RETRY_MS.length - 1)]!;
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => void run(), delay);
          }
        }
        return false;
      }
    }
  };

  /** Call after every local edit. */
  const markDirty = useCallback(() => {
    version.current += 1;
    if (stateRef.current === 'conflict') return;
    if (stateRef.current !== 'saving') set('dirty');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void run(), DEBOUNCE_MS);
  }, [run]);

  /** Save immediately (Save Draft, Ctrl+S, before publishing). Resolves true once the server has everything. */
  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (stateRef.current === 'error') savedVersion.current = -1; // force a retry
    return run();
  }, [run]);

  /** After a conflict: adopt the server's newest revision and save this tab's content over it. */
  const overwrite = useCallback(async () => {
    const latest = await api.get<AdminPost>(`/api/admin/posts/${optsRef.current.postId}`);
    revision.current = latest.revision;
    savedVersion.current = -1;
    set('dirty');
    return run();
  }, [run]);

  /** The server copy now matches the editor (e.g. after "Discard changes"). */
  const markClean = useCallback(() => {
    window.clearTimeout(timer.current);
    savedVersion.current = version.current;
    setError(null);
    set('saved');
  }, []);

  /** Stop autosaving and unsaved-work warnings (the article was deleted or is being reloaded). */
  const suspended = useRef(false);
  const suspend = useCallback(() => {
    suspended.current = true;
    window.clearTimeout(timer.current);
  }, []);

  const hasUnsaved = () => !suspended.current && ( version.current !== savedVersion.current || stateRef.current === 'saving' || stateRef.current === 'error' || stateRef.current === 'conflict');

  // Warn before closing the tab or navigating away with unsaved work.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!hasUnsaved()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { state, lastSavedAt, error, markDirty, markClean, suspend, flush, overwrite, revision, hasUnsaved };
}
