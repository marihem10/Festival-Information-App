// 🔧 일회성 마이그레이션 스크립트: extraFestivals.js에 있던 항목들을 Firestore로 옮김.
// 실행 방법: 프로젝트 폴더에서  node migrate-to-firestore.js
//
// ⚠️ 이미 Firestore에 넣어둔 테스트 문서가 있다면, 이 스크립트 실행 전에
//    Firestore 콘솔에서 그 테스트 문서는 지워주세요 (안 지워도 앱은 안 깨지지만 중복으로 뜰 수 있음).

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
const extraFestivals = require('./extraFestivals');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function migrate() {
  console.log(`총 ${extraFestivals.length}건을 Firestore로 옮깁니다...`);

  let successCount = 0;
  for (const fest of extraFestivals) {
    try {
      // add()를 쓰면 문서 ID를 Firestore가 알아서 자동으로 만들어줌
      await db.collection('festivals').add(fest);
      console.log(`✅ 추가됨: ${fest.title}`);
      successCount += 1;
    } catch (e) {
      console.log(`❌ 실패: ${fest.title} - ${e.message}`);
    }
  }

  console.log(`\n완료: ${successCount}/${extraFestivals.length}건 성공`);
  process.exit(0);
}

migrate();
