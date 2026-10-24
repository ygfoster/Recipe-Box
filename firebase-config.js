// YouTube Data API のキー(概要欄から材料・作り方を読み取るのに使う)。null なら使わない。
// Google Cloud で「ウェブサイトの制限(ygfoster.github.io)」と「YouTube Data API v3 のみ」を設定したキーを入れる。
window.RB_YOUTUBE_API_KEY = null;

// Firebase コンソールの「プロジェクトの設定 → マイアプリ」にある firebaseConfig。
// null にすると、同期なし(この端末だけに保存)で動く。
// ※ この値は公開されても問題ない識別子。データはセキュリティルールで本人だけに制限する。
window.RB_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyB5Xhstp4CravwebakEyd5gBShuntgsBJA',
  authDomain: 'recipe-box-50179.firebaseapp.com',
  projectId: 'recipe-box-50179',
  storageBucket: 'recipe-box-50179.firebasestorage.app',
  messagingSenderId: '856285359761',
  appId: '1:856285359761:web:53b1846e6bafd83ae95930',
};
