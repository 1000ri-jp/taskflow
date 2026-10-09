import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ProjectEmojiPicker } from './ProjectEmojiPicker';
import { loadProjectEmojis, PROJECT_EMOJI_QUICK_CHOICES, type ProjectEmoji } from '@/lib/project-emojis';
import catalog from '@/lib/project-emojis.generated.json';

vi.mock('@/lib/project-emojis', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/project-emojis')>();
  return { ...actual, loadProjectEmojis: vi.fn(actual.loadProjectEmojis) };
});

beforeEach(() => vi.clearAllMocks());

it('opens choices from the icon and closes them after selecting without submitting a surrounding form', async () => {
  const onChange = vi.fn();
  const onSubmit = vi.fn(event => event.preventDefault());
  const { rerender } = render(<form onSubmit={onSubmit}><ProjectEmojiPicker value="📁" onChange={onChange} /></form>);
  expect(loadProjectEmojis).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('絵文字を検索')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'すべての絵文字から選ぶ' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', {name:'絵文字アイコンを変更'}));
  const choices = screen.getByLabelText('絵文字の候補');
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('3,944件'));
  expect(within(choices).getAllByRole('button')).toHaveLength(80);
  expect(within(choices).getAllByRole('button').slice(0,11).map(button => button.getAttribute('aria-label')))
    .toEqual(PROJECT_EMOJI_QUICK_CHOICES.map(item => `${item.emoji} ${item.name}`));
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  expect(screen.getByRole('status')).toHaveTextContent('2 / 50ページ');
  fireEvent.change(screen.getByLabelText('絵文字を検索'), { target: { value: '🧑🏽‍🚒' } });
  const chosen = await screen.findByRole('button', { name: '🧑🏽‍🚒 消防士: 中間の肌色' });
  fireEvent.keyDown(screen.getByLabelText('絵文字を検索'), { key: 'Enter' });
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.click(chosen);
  expect(onChange).toHaveBeenCalledWith('🧑🏽‍🚒');
  expect(screen.queryByLabelText('絵文字を検索')).not.toBeInTheDocument();
  rerender(<form onSubmit={onSubmit}><ProjectEmojiPicker value="🧑🏽‍🚒" onChange={onChange} /></form>);
  expect(screen.getByRole('button',{name:'絵文字アイコンを変更'})).toHaveTextContent('🧑🏽‍🚒');
  fireEvent.click(screen.getByRole('button', {name:'絵文字アイコンを変更'}));
  expect(await screen.findByRole('button', { name: '🧑🏽‍🚒 消防士: 中間の肌色' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.change(screen.getByLabelText('絵文字を検索'), { target: { value: 'no-such-emoji-1234' } });
  expect(screen.getByText(/一致する絵文字がありません/)).toBeVisible();
  expect(screen.getByText('選択中：消防士: 中間の肌色')).toBeVisible();
  expect(onChange).toHaveBeenCalledTimes(1);
});

it('retains the current choice after a catalog load failure and retries without changing it', async () => {
  vi.mocked(loadProjectEmojis).mockRejectedValueOnce(new Error('chunk unavailable'));
  const onChange = vi.fn();
  render(<ProjectEmojiPicker value="🇯🇵" onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', {name:'絵文字アイコンを変更'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('絵文字を読み込めませんでした');
  expect(screen.getByRole('button', { name: '📁 フォルダー' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
  await screen.findByLabelText('絵文字を検索');
  await waitFor(() => expect(screen.getByText('選択中：旗: 日本')).toBeVisible());
  expect(onChange).not.toHaveBeenCalled();
});

it('keeps familiar choices usable while loading and preserves an early search when the full catalog arrives', async () => {
  let finish!: (items: ProjectEmoji[]) => void;
  vi.mocked(loadProjectEmojis).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const onChange = vi.fn();
  render(<ProjectEmojiPicker value="📁" onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', {name:'絵文字アイコンを変更'}));
  expect(screen.getByRole('button', { name: '🦙 ラマ' })).toBeEnabled();
  fireEvent.change(screen.getByLabelText('絵文字を検索'), {target:{value:'日本'}});
  expect(screen.queryByText(/一致する絵文字がありません/)).not.toBeInTheDocument();
  finish(catalog.emojis);
  expect(await screen.findByRole('button', {name:'🇯🇵 旗: 日本'})).toBeVisible();
  expect(screen.getByLabelText('絵文字を検索')).toHaveValue('日本');
  expect(onChange).not.toHaveBeenCalled();
});

it('allows a familiar icon to be selected before the full catalog has loaded', () => {
  vi.mocked(loadProjectEmojis).mockImplementationOnce(() => new Promise(() => {}));
  const onChange = vi.fn();
  render(<ProjectEmojiPicker value="📁" onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', {name:'絵文字アイコンを変更'}));
  fireEvent.click(screen.getByRole('button', {name:'🦙 ラマ'}));
  expect(onChange).toHaveBeenCalledWith('🦙');
  expect(screen.queryByLabelText('絵文字を検索')).not.toBeInTheDocument();
});
