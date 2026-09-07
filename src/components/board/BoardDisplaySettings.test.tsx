import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { BoardDisplaySettings } from './BoardDisplaySettings';
import { BOARD_DISPLAY_STORAGE_KEY, DEFAULT_BOARD_DISPLAY, useBoardDisplayStore } from '@/stores/boardDisplayStore';
import { BOARD_SORT_STORAGE_KEY, useBoardSortStore } from '@/stores/boardSortStore';

describe('BoardDisplaySettings', () => {
  beforeEach(() => {
    localStorage.removeItem(BOARD_DISPLAY_STORAGE_KEY);
    useBoardDisplayStore.setState({ settings: { ...DEFAULT_BOARD_DISPLAY } });
    localStorage.removeItem(BOARD_SORT_STORAGE_KEY);
    useBoardSortStore.setState({byProject:{},persistenceFailed:false});
  });

  it('toggles each metadata option and resets the defaults', () => {
    render(<BoardDisplaySettings />);
    fireEvent.click(screen.getByRole('button', { name: '表示設定' }));
    expect(screen.getByRole('checkbox', { name: '列名' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: '担当者' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '優先度' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'タグ' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: '列名' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '担当者' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '優先度' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'タグ' }));
    expect(useBoardDisplayStore.getState().settings).toEqual({ showListName: true, showAssignees: false, showPriority: false, showTags: false });
    fireEvent.click(screen.getByRole('button', { name: '初期設定に戻す' }));
    expect(useBoardDisplayStore.getState().settings).toEqual(DEFAULT_BOARD_DISPLAY);
  });

  it('restores saved settings on remount', () => {
    const { unmount } = render(<BoardDisplaySettings />);
    fireEvent.click(screen.getByRole('button', { name: '表示設定' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '列名' }));
    unmount();
    useBoardDisplayStore.setState({ settings: { ...DEFAULT_BOARD_DISPLAY } });
    render(<BoardDisplaySettings />);
    fireEvent.click(screen.getByRole('button', { name: '表示設定' }));
    expect(screen.getByRole('checkbox', { name: '列名' })).toBeChecked();
  });
  it('lets each project choose date order without altering card metadata', () => {
    render(<BoardDisplaySettings projectId="p" />);
    fireEvent.click(screen.getByRole('button',{name:'表示設定'}));
    fireEvent.change(screen.getByRole('combobox',{name:'タスクの並び順'}),{target:{value:'due-asc'}});
    expect(useBoardSortStore.getState().byProject.p).toBe('due-asc');
    expect(useBoardDisplayStore.getState().settings).toEqual(DEFAULT_BOARD_DISPLAY);
    expect(screen.getByText(/ドラッグ移動を停止/)).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'初期設定に戻す'}));
    expect(useBoardSortStore.getState().byProject.p).toBe('manual');
  });
});
