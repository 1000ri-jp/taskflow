import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
let javascript: string, css: string;
const longId = 'reader_' + 'a'.repeat(121);
const editorId = 'fixture-editor';
test.beforeAll(async () => {
  const root = process.cwd();
  // Actual production component and shared styles; only authentication and HTTP are fictional.
  const result = await build({ bundle: true, write: false, format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import {createRoot} from 'react-dom/client';
      import Consent from './src/app/mcp-connect/consent';
      window.fixtureClient = 'chatgpt';
      window.fetch = async (_url, options = {}) => {
        if (options.method === 'POST') { window.submittedConsent = JSON.parse(options.body); return new Response('{}', {status:403}); }
        return new Response(JSON.stringify({consentVersion:2,mode:'production',client:window.fixtureClient,redirectHost:window.fixtureClient==='claude-code'?'localhost':window.fixtureClient==='claude'?'claude.ai':window.fixtureClient==='muse'?'agent.meta.ai':'chatgpt.com',maxProjects:500,taskScopes:['tasks:read','tasks:write'],projects:[
          {id:'${editorId}',name:'架空の編集プロジェクト',canWrite:true,canWork:true,canNotify:true},
          {id:'${longId}',name:'架空の閲覧プロジェクト・長い名前と説明がある場合の表示確認',canWrite:false,canWork:false,canNotify:false}
        ]}));
      };
      const root = createRoot(document.getElementById('root'));
      window.changeInteraction = value => root.render(<Consent interaction={value}/>);
      window.changeInteraction('fixture-interaction');`, },
    plugins: [{ name: 'fictional-auth', setup(builder) {
      builder.onResolve({ filter: /^@\/hooks\/useAuth$/ }, () => ({ path: 'fixture-auth', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `const user={uid:'fixture-user',email:'fixture@example.test',getIdToken:async()=> 'fictional-token'};export function useAuth(){return {firebaseUser:user,isLoading:false,signInForMcp:async()=>{}}}` }));
    } }],
  });
  javascript = result.outputFiles[0].text;
  css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.join(root, 'src/app/globals.css') })).css;
});
for (const width of [1200, 390]) test(`explicit current-project consent at ${width}px`, async ({ page }, info) => {
  const requests: string[] = []; page.on('request', request => requests.push(request.url()));
  await page.setViewportSize({ width, height: 950 });
  await page.setContent('<!doctype html><html lang="ja"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: javascript });
  const allow = page.getByRole('button', { name: '選択した範囲で30日間の接続を許可' });
  await expect(allow).toBeDisabled();
  await page.getByRole('button', { name: '現在閲覧できる全件を読み取り対象にする' }).click();
  await expect(allow).toBeEnabled();
  for (const name of ['架空の編集プロジェクトの書き込み', '架空の編集プロジェクトのAI作業', '架空の編集プロジェクトの更新通知']) await expect(page.getByRole('checkbox', { name })).not.toBeChecked();
  await expect(page.getByText(/今回同意する対象/)).toContainText('読み取り：架空の編集プロジェクト、架空の閲覧プロジェクト');
  await expect(page.getByText(/今後追加されるプロジェクトの自動許可/)).toContainText('無効');
  await page.screenshot({ path: info.outputPath('read-all.png'), fullPage: true });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
  await page.getByRole('checkbox', { name: '架空の編集プロジェクトの書き込み' }).check();
  await page.getByRole('checkbox', { name: '架空の編集プロジェクトのAI作業' }).check();
  await page.getByRole('checkbox', { name: '架空の編集プロジェクトの更新通知' }).check();
  await allow.click(); await expect(page.getByRole('alert')).toContainText('接続を完了できません');
  expect(await page.evaluate(() => (window as unknown as { submittedConsent: unknown }).submittedConsent)).toEqual({
    interaction: 'fixture-interaction', approve: true, consentVersion: 2, includeFutureProjects: false,
    projectIds: [editorId, longId], writeProjectIds: [editorId], aiProjectIds: [editorId], eventProjectIds: [editorId],
  });
  expect(requests).toEqual([]);
});

for (const client of ['claude-code', 'claude', 'muse']) for (const width of [1200, 390]) test(`${client} current-project consent at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 950 });
  await page.setContent('<!doctype html><html lang="ja"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: javascript });
  await page.evaluate(client => {
    const fixture = window as unknown as { fixtureClient: string; changeInteraction: (value: string) => void };
    fixture.fixtureClient = client; fixture.changeInteraction('fixture-claude');
  }, client);
  await expect(page.getByRole('heading', { name: (client === 'muse' ? 'Muse' : client === 'claude-code' ? 'Claude Code' : 'Claude') + 'との接続確認' })).toBeVisible();
  await page.getByRole('button', { name: '現在閲覧できる全件を読み取り対象にする' }).click();
  await expect(page.getByRole('checkbox', { name: '架空の編集プロジェクトの更新通知' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: '架空の編集プロジェクトの書き込み' }).check();
  await page.getByRole('checkbox', { name: '架空の編集プロジェクトのAI作業' }).check();
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
  await page.screenshot({ path: info.outputPath(client + '-consent.png'), fullPage: true });
  await page.getByRole('button', { name: '選択した範囲で30日間の接続を許可' }).click();
  await expect(page.getByRole('alert')).toContainText('接続を完了できません');
  expect(await page.evaluate(() => (window as unknown as { submittedConsent: unknown }).submittedConsent)).toEqual({
    interaction: 'fixture-claude', approve: true, consentVersion: 2, includeFutureProjects: false,
    projectIds: [editorId, longId], writeProjectIds: [editorId], aiProjectIds: [editorId], eventProjectIds: [],
  });
});
