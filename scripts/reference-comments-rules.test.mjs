import fs from 'node:fs';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection, updateDoc, deleteDoc, serverTimestamp, runTransaction } from 'firebase/firestore';
const address = process.env.FIRESTORE_EMULATOR_HOST;
if (!address || !/^127\.0\.0\.1:\d+$/.test(address)) throw new Error('A loopback Firestore emulator is required.');
const env = await initializeTestEnvironment({ projectId: 'demo-taskflow-release', firestore: { host: '127.0.0.1', port: Number(address.split(':')[1]), rules: fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
let count = 0;
const check = async (name, action) => { await action(); count++; console.log('PASS ' + name); };
const comment = (uid, content = 'Synthetic comment') => ({ referenceId: 'r', content, authorId: uid, authorLabel: uid, attachments: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
const path = 'projects/p/references/r/comments';
const auth = role => role === 'anonymous' ? env.unauthenticatedContext().firestore() : env.authenticatedContext(role, { email: `${role}@${role === 'external' ? 'example.com' : '1000ri.jp'}`, email_verified: true }).firestore();
try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'projects/p'), { ownerId: 'owner', memberIds: ['owner', 'admin', 'editor', 'viewer', 'legacy'] });
    for (const role of ['admin', 'editor', 'viewer']) await setDoc(doc(db, `projects/p/members/${role}`), { userId: role, role });
    await setDoc(doc(db, 'projects/p/references/r'), { title: 'Existing title', body: 'Existing body', comment: 'Legacy comment', isArchived: false });
    await setDoc(doc(db, `${path}/old`), comment('owner'));
  });
  for (const role of ['owner', 'admin', 'editor', 'viewer', 'legacy', 'outsider', 'external', 'anonymous']) {
    const db = auth(role);
    const read = ['owner', 'admin', 'editor', 'viewer', 'legacy'].includes(role);
    const write = ['owner', 'admin', 'editor'].includes(role);
    await check(`${role} read`, () => (read ? assertSucceeds : assertFails)(getDocs(collection(db, path))));
    await check(`${role} post`, () => (write ? assertSucceeds : assertFails)(setDoc(doc(db, `${path}/${role}`), comment(role))));
    await check(`${role} edit`, () => (write ? assertSucceeds : assertFails)(updateDoc(doc(db, `${path}/old`), { content: role, updatedAt: serverTimestamp() })));
    await check(`${role} delete`, () => (write ? assertSucceeds : assertFails)(deleteDoc(doc(db, `${path}/${role}`))));
  }
  const db = auth('editor');
  await check('cannot forge author', () => assertFails(setDoc(doc(db, `${path}/forged`), comment('owner'))));
  await check('cannot rewrite original author', () => assertFails(updateDoc(doc(db, `${path}/old`), { authorId: 'editor', updatedAt: serverTimestamp() })));
  await check('cannot post empty content', () => assertFails(setDoc(doc(db, `${path}/empty`), comment('editor', ''))));
  await check('cannot post oversized content', () => assertFails(setDoc(doc(db, `${path}/large`), comment('editor', 'x'.repeat(20001)))));
  await check('cannot post orphan comments', () => assertFails(setDoc(doc(db, 'projects/p/references/missing/comments/c'), { ...comment('editor'), referenceId: 'missing' })));
  const post = async (id, content) => runTransaction(db, async tx => {
    const target = doc(db, `${path}/${id}`);
    const snapshot = await tx.get(target);
    if (!snapshot.exists()) tx.set(target, comment('editor', content));
  });
  await check('concurrent posts and uncertain retry preserve separate history', async () => {
    await Promise.all([post('a', 'First'), post('b', 'Second')]);
    await post('a', 'First');
    const rows = await getDocs(collection(db, path));
    assert.equal(rows.size, 3);
    assert.equal((await getDoc(doc(db, `${path}/a`))).data().content, 'First');
    assert.equal((await getDoc(doc(db, `${path}/b`))).data().content, 'Second');
    assert.equal((await getDoc(doc(db, 'projects/p/references/r'))).data().comment, 'Legacy comment');
  });
  await updateDoc(doc(db, 'projects/p/references/r'), { isArchived: true });
  await check('archived history remains readable', () => assertSucceeds(getDocs(collection(db, path))));
  await check('archived reference rejects new posts', () => assertFails(setDoc(doc(db, `${path}/archived`), comment('editor'))));
  console.log(`${count} reference comment checks passed`);
} finally { await env.cleanup(); }
