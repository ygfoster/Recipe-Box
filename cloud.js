// Firebase(Google ログイン + Firestore)でレシピを端末間同期する
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, deleteDoc, onSnapshot, query, where, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const cfg = window.RB_FIREBASE_CONFIG;
const RB = window.RB;

if (cfg && RB) {
  const app = initializeApp(cfg);
  const auth = getAuth(app);
  // 端末内にもキャッシュするので、電波がなくても読み書きでき、つながったときに同期される
  const fs = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  const recipeDoc = (id) => doc(fs, 'users', auth.currentUser.uid, 'recipes', id);
  const settingsDoc = (uid) => doc(fs, 'users', uid, 'meta', 'settings');
  let unsub = null;
  let unsubSettings = null;
  let unsubOthers = [];

  RB.attachCloud({
    async signIn() {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await signInWithPopup(auth, provider);
      } catch (e) {
        if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
          await signInWithRedirect(auth, provider);
        } else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
          throw e;
        }
      }
    },
    signOut: () => signOut(auth),
    // オフラインだとサーバーの応答を待つと止まってしまうので、書き込みは投げっぱなしにする
    put(r) {
      setDoc(recipeDoc(r.id), r).catch((e) => RB.onSyncError(e));
    },
    del(id) {
      deleteDoc(recipeDoc(id)).catch((e) => RB.onSyncError(e));
    },
    putSettings(data) {
      if (auth.currentUser) setDoc(settingsDoc(auth.currentUser.uid), data).catch((e) => RB.onSyncError(e));
    },
    // 献立(plan)・買い物リスト(shopping)はまとめて書く。1回の上限が500件なので450件ずつに分ける
    batch(col, ops) {
      const uid = auth.currentUser && auth.currentUser.uid;
      if (!uid) return;
      for (let i = 0; i < ops.length; i += 450) {
        const b = writeBatch(fs);
        ops.slice(i, i + 450).forEach((op) => {
          const ref = doc(fs, 'users', uid, col, op.type === 'del' ? op.id : op.d.id);
          if (op.type === 'del') b.delete(ref); else b.set(ref, op.d);
        });
        b.commit().catch((e) => RB.onSyncError(e));
      }
    },
  });

  onAuthStateChanged(auth, (user) => {
    if (unsub) { unsub(); unsub = null; }
    if (unsubSettings) { unsubSettings(); unsubSettings = null; }
    unsubOthers.forEach((u) => u());
    unsubOthers = [];
    RB.onAuth(user ? { uid: user.uid, name: user.displayName || '', email: user.email || '', photo: user.photoURL || '' } : null);
    if (!user) return;
    unsubSettings = onSnapshot(
      settingsDoc(user.uid),
      (snap) => { if (!snap.metadata.fromCache || snap.exists()) RB.onSettings(snap.exists() ? snap.data() : null); },
      (err) => RB.onSyncError(err)
    );
    // 献立は直近60日より前のものは読まない(年単位で増えても軽いまま)
    const since = new Date(Date.now() - 60 * 864e5).toLocaleDateString('sv-SE');
    const watch = (col, q) => unsubOthers.push(onSnapshot(
      q,
      (snap) => RB.onCollection(col, snap.docChanges().map((c) => ({ type: c.type, id: c.doc.id, data: c.doc.data() }))),
      (err) => RB.onSyncError(err)
    ));
    watch('plan', query(collection(fs, 'users', user.uid, 'plan'), where('date', '>=', since)));
    watch('shopping', collection(fs, 'users', user.uid, 'shopping'));
    unsub = onSnapshot(
      collection(fs, 'users', user.uid, 'recipes'),
      { includeMetadataChanges: true },
      (snap) => RB.onSnapshot({
        changes: snap.docChanges().map((c) => ({ type: c.type, id: c.doc.id, data: c.doc.data() })),
        fromCache: snap.metadata.fromCache,
        pending: snap.metadata.hasPendingWrites,
      }),
      (err) => RB.onSyncError(err)
    );
  });
}
