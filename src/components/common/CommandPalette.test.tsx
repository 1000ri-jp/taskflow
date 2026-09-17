import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from './CommandPalette';
import type { SearchResult } from '@/hooks/useGlobalSearch';
const state = vi.hoisted(() => ({ query: '仕事', projectResults: [] as SearchResult[], taskResults: [] as SearchResult[], error: null as string | null, isSearching:false, retry:vi.fn(), push:vi.fn(), close:vi.fn(), setQuery:vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push:state.push }) }));
vi.mock('@/hooks/useGlobalSearch', () => ({ useGlobalSearch: () => state }));
vi.mock('@/stores/uiStore', () => ({ useUIStore: () => ({ isCommandPaletteOpen:true,closeCommandPalette:state.close,openProjectModal:vi.fn() }) }));
beforeEach(() => {
  state.query='仕事';state.projectResults=[];state.taskResults=[];state.error=null;state.isSearching=false;
  state.retry.mockReset();state.push.mockReset();state.close.mockReset();
  Element.prototype.scrollIntoView=vi.fn();
});
describe('search keyboard and states', () => {
  it('names the input and only selects the 20 tasks actually rendered', async () => {
    state.taskResults=Array.from({length:25},(_,i)=>({id:`t${i}`,type:'task',title:`仕事${i}`,projectId:'p1',projectName:'案件',description:'',projectIcon:'📁',projectColor:''}));
    render(<CommandPalette />);
    const input=screen.getByRole('combobox',{name:'プロジェクトやタスクを検索'});
    await waitFor(()=>expect(input).toHaveFocus());
    const options=screen.getAllByRole('option');expect(options).toHaveLength(20);
    expect(input).toHaveAttribute('aria-controls',screen.getByRole('listbox',{name:'検索候補'}).id);
    fireEvent.keyDown(input,{key:'ArrowUp'});
    expect(options[19]).toHaveAttribute('aria-selected','true');
    expect(input).toHaveAttribute('aria-activedescendant',options[19].id);
    fireEvent.keyDown(input,{key:'Enter'});
    expect(state.push).toHaveBeenLastCalledWith('/projects/p1/board?task=t19');
    fireEvent.keyDown(input,{key:'ArrowDown'});
    expect(input).toHaveAttribute('aria-activedescendant',options[0].id);
  });
  it('does not claim zero matches when fetch failed and allows retry', () => {
    state.error='一部のタスクを取得できませんでした。';render(<CommandPalette />);
    expect(screen.getByRole('alert')).toHaveTextContent(state.error);
    expect(screen.queryByText('検索結果が見つかりませんでした')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'再取得'}));expect(state.retry).toHaveBeenCalledOnce();
  });
  it('does not refer to an absent active option for an empty result', () => {
    render(<CommandPalette />);const input=screen.getByRole('combobox');
    fireEvent.keyDown(input,{key:'ArrowUp'});fireEvent.keyDown(input,{key:'Enter'});
    expect(input).not.toHaveAttribute('aria-activedescendant');expect(state.push).not.toHaveBeenCalled();
    expect(screen.getByText('検索結果が見つかりませんでした')).toBeVisible();
  });
});
