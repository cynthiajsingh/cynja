import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface Match { from: number; to: number }
export interface SearchState { term: string; caseSensitive: boolean; matches: Match[]; current: number }

type PluginState = SearchState & { decorations: DecorationSet };
export const searchKey = new PluginKey<PluginState>('searchReplace');

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    searchReplace: {
      setSearch: (term: string, caseSensitive?: boolean) => ReturnType;
      clearSearch: () => ReturnType;
      gotoMatch: (direction: 1 | -1) => ReturnType;
      replaceCurrent: (replacement: string) => ReturnType;
      replaceAll: (replacement: string) => ReturnType;
    };
  }
}

/** Finds matches per text block, so a phrase split across bold/italic still matches. */
export function findMatches(doc: PMNode, term: string, caseSensitive: boolean): Match[] {
  if (!term) return [];
  const needle = caseSensitive ? term : term.toLowerCase();
  const out: Match[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    const map: number[] = [];
    node.forEach((child, offset) => {
      if (child.isText && child.text) {
        for (let k = 0; k < child.text.length; k++) map.push(pos + 1 + offset + k);
        text += child.text;
      } else {
        map.push(pos + 1 + offset);
        text += '￼';
      }
    });
    const hay = caseSensitive ? text : text.toLowerCase();
    let i = hay.indexOf(needle);
    while (i !== -1) {
      out.push({ from: map[i]!, to: map[i + needle.length - 1]! + 1 });
      i = hay.indexOf(needle, i + needle.length);
    }
    return false;
  });
  return out;
}

function decorate(doc: PMNode, matches: Match[], current: number): DecorationSet {
  return DecorationSet.create(doc, matches.map((m, i) =>
    Decoration.inline(m.from, m.to, { class: i === current ? 'search-hit search-hit-current' : 'search-hit' })));
}

export const SearchReplace = Extension.create({
  name: 'searchReplace',

  addProseMirrorPlugins() {
    return [
      new Plugin<PluginState>({
        key: searchKey,
        state: {
          init: (): PluginState => ({ term: '', caseSensitive: false, matches: [], current: 0, decorations: DecorationSet.empty }),
          apply(tr, prev): PluginState {
            const meta = tr.getMeta(searchKey) as Partial<SearchState> | undefined;
            if (!meta && !tr.docChanged) return prev;
            const term = meta?.term ?? prev.term;
            const caseSensitive = meta?.caseSensitive ?? prev.caseSensitive;
            const matches = findMatches(tr.doc, term, caseSensitive);
            const current = Math.min(meta?.current ?? prev.current, Math.max(0, matches.length - 1));
            return { term, caseSensitive, matches, current, decorations: decorate(tr.doc, matches, current) };
          },
        },
        props: {
          decorations: (state) => searchKey.getState(state)?.decorations,
        },
      }),
    ];
  },

  addCommands() {
    const select = (tr: import('@tiptap/pm/state').Transaction, m: Match | undefined) => {
      if (m) tr.setSelection(TextSelection.create(tr.doc, m.from, m.to)).scrollIntoView();
      return tr;
    };
    return {
      setSearch: (term, caseSensitive = false) => ({ tr, dispatch, state }) => {
        if (dispatch) {
          const matches = findMatches(state.doc, term, caseSensitive);
          const from = state.selection.from;
          const current = Math.max(0, matches.findIndex((m) => m.from >= from));
          tr.setMeta(searchKey, { term, caseSensitive, current });
          select(tr, matches[current]);
        }
        return true;
      },
      clearSearch: () => ({ tr, dispatch }) => {
        if (dispatch) tr.setMeta(searchKey, { term: '', current: 0 });
        return true;
      },
      gotoMatch: (direction) => ({ tr, dispatch, state }) => {
        const s = searchKey.getState(state);
        if (!s || !s.matches.length) return false;
        if (dispatch) {
          const current = (s.current + direction + s.matches.length) % s.matches.length;
          tr.setMeta(searchKey, { current });
          select(tr, s.matches[current]);
        }
        return true;
      },
      replaceCurrent: (replacement) => ({ tr, dispatch, state }) => {
        const s = searchKey.getState(state);
        const m = s?.matches[s.current];
        if (!s || !m) return false;
        if (dispatch) {
          if (replacement) tr.insertText(replacement, m.from, m.to);
          else tr.delete(m.from, m.to);
          tr.setMeta(searchKey, { current: s.current });
        }
        return true;
      },
      replaceAll: (replacement) => ({ tr, dispatch, state }) => {
        const s = searchKey.getState(state);
        if (!s || !s.matches.length) return false;
        if (dispatch) {
          for (const m of [...s.matches].reverse()) {
            if (replacement) tr.insertText(replacement, m.from, m.to);
            else tr.delete(m.from, m.to);
          }
          tr.setMeta(searchKey, { current: 0 });
        }
        return true;
      },
    };
  },
});
