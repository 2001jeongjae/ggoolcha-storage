# STORAGE

EV 자작차 동아리의 부품·공구·소모품 재고와 사용 기록을 한곳에서 관리하는 웹사이트입니다.
누가 언제 무엇을 꺼냈고 어디에 두었는지를 팀·직책·이름과 사진으로 남깁니다.

## 기능

- **재고**: 품목 등록(사진 = 보관 위치), 같은 품목 중복 방지·합치기, 수량 추가·제거
- **공구**: 사용 시작 → 사용 완료(둔 위치·사진, 분실·파손 수량)
- **부품**: 차량 장착 → 탈거(장착 부위, 폐기 수량)
- **소모품**: 사용량 기록과 남은 수량, 최소 수량 이하이면 '구매 필요'에 모음
- **최근 기록**: 모든 사용·수량 변경이 시간순으로 쌓이고, 잘못 넣은 기록은 수량까지 되돌리며 삭제
- **구매현황·배송현황**: 팀별 구매 기록과 영수증 사진, 주문·송장 번호로 배송 추적
- **입장 코드**: 동아리원만 읽고 쓸 수 있도록 처음 접속한 기기에서 코드를 확인

## 구조

| 파일 | 역할 |
| --- | --- |
| `index.html` | 배포되는 페이지 (빌드 결과물, 직접 고치지 않음) |
| `src/app.html` | 화면 원본 (HTML·CSS·JavaScript) |
| `src/adapter.js` | 화면이 쓰는 저장소 연결을 Firebase로 이어 주는 연결부 |
| `src/firebase-config.js` | Firebase 웹 앱 설정 값 |
| `src/site-config.js` | 요금제(기본·프로)와 프로 기한 |
| `src/intro.html` → `intro.html` | 공개 소개·요금·설치 신청 페이지 (`/intro`) |
| `assets/` | 소개 페이지 화면 사진 |
| `src/build.py` | 위 파일을 합쳐 `index.html`과 `intro.html`을 만드는 스크립트 (`python3 src/build.py`) |
| `firestore.rules` | Firestore 보안 규칙 (입장 코드를 맞힌 기기만 접근) |
| `api/read-order.js`, `vercel.json` | 예전 Gemini 사진 읽기용 서버 함수 (지금은 쓰지 않음) |

- 호스팅: Vercel (GitHub 저장소에 올리면 자동 배포)
- 데이터: Google Firebase Cloud Firestore (items · loans · purchases · ships · photos 컬렉션)
- 로그인: Firebase 익명 로그인 + 동아리 입장 코드(`config/club` 문서, 앱에서는 읽을 수 없음)
- 사진: 브라우저에서 1280px 이하 JPEG로 줄여 Firestore 문서에 저장
- 사진 자동 입력: 브라우저 안에서 [Tesseract.js](https://github.com/naptha/tesseract.js) OCR(한국어+영어)로 주문 화면 글자를 읽고, 규칙으로 구매일·구매처·금액·주문번호·품목(이름·규격·수량·단가·분류)·택배사·운송장을 뽑음. 사진과 글자는 기기 밖으로 나가지 않고, 키도 필요 없음. 이름·전화번호·주소는 먼저 가리고, 영수증에는 가린 사진만 저장
  - 처음 한 번 jsDelivr에서 글자 인식 엔진과 한국어·영어 데이터(약 8MB)를 내려받아 브라우저에 보관
  - 한 번 읽어서 품목 합계가 결제 금액과 안 맞으면 다른 설정으로 한 번 더 읽고 나은 쪽을 씀

## 수익 운영 (다른 동아리에 설치해 주기)

공개 소개 페이지 `/intro`에서 다른 동아리가 설치를 신청하고, 동아리마다 이 저장소를 복사한 전용 사이트를 만들어 준다. 동아리마다 저장 공간·주소·입장 코드가 따로라 데이터가 섞이지 않는다.

| 요금제 | 가격 (소개 페이지 기준) | 내용 |
| --- | --- | --- |
| 기본 | 30,000원, 설치 1회 | 재고·공구·부품·소모품, 구매·배송, 사진 자동 입력 |
| 프로 | 연 50,000원, 설치비 포함 | 기본 + 지원금 정산 리포트(엑셀) + 영수증 모아 인쇄 + 1년 업데이트·문의 대응 |

가격과 문구는 `src/intro.html`에서 고친 뒤 `python3 src/build.py`.

### 신청 확인
Firebase 콘솔 → Firestore → `leads` 컬렉션. 신청서는 누구나 쓰기만 할 수 있고(보안 규칙), 읽기는 콘솔에서만 된다. 상담이 끝난 신청서는 1년 안에 지운다(소개 페이지에 그렇게 안내함).

### 새 동아리 사이트 만들기 (약 20분)
1. 이 저장소를 새 저장소로 복사 (GitHub → Use this template 또는 파일 업로드)
2. 아래 "처음 설정하기" 1~3단계를 새 Firebase 프로젝트·새 Vercel 프로젝트로 그대로 진행
3. `src/firebase-config.js`에 새 Firebase 설정, `src/site-config.js`에 요금제를 적고 `python3 src/build.py`
4. 팀 이름이 다르면 `src/app.html`의 `const TEAMS = [...]` 수정
5. 새 주소와 입장 코드를 동아리 담당자에게 전달

### 요금제 바꾸기
`src/site-config.js`의 `plan`을 `"pro"` 또는 `"basic"`으로, 프로 기한은 `proUntil: "YYYY-MM-DD"`(그날까지). 바꾼 뒤 빌드해서 올리면 된다. 기본 요금제에서는 정산 리포트 요약만 보이고 엑셀·인쇄 버튼은 잠긴다.

> 저장소가 공개(Public)라 누구나 코드를 복사해 프로 기능을 켤 수 있다. 막고 싶으면 GitHub 저장소를 비공개(Private)로 바꾸면 된다(Vercel 무료 요금제에서도 비공개 저장소 배포 가능).

## 처음 설정하기

### 1. Firebase (데이터 저장소)

1. <https://console.firebase.google.com> → **프로젝트 만들기** → 이름 `ggoolcha-storage` (Google 애널리틱스는 꺼도 됩니다)
2. 왼쪽 **빌드 → Firestore Database → 데이터베이스 만들기**
   - 위치: `asia-northeast3 (서울)`
   - **프로덕션 모드**로 시작
3. Firestore의 **규칙** 탭 → 내용을 모두 지우고 `firestore.rules` 파일 내용을 붙여 넣기 → **게시**
4. Firestore의 **데이터** 탭 → **컬렉션 시작**
   - 컬렉션 ID: `config`
   - 문서 ID: `club`
   - 필드: `code` / 유형 `string` / 값 = 동아리원에게 알려 줄 **입장 코드**
5. 왼쪽 **빌드 → Authentication → 시작하기 → 로그인 방법** → **익명** → 사용 설정 → 저장
6. 톱니바퀴 **프로젝트 설정 → 일반 → 내 앱**에서 웹 아이콘 `</>` → 앱 닉네임 입력 → **앱 등록**
   - 화면에 나오는 `firebaseConfig = { apiKey: ..., projectId: ..., ... }` 값을
     `src/firebase-config.js`의 `window.GGOOLCHA_FIREBASE = { ... }` 칸에 옮겨 적고 `python3 src/build.py` 실행
   - 이 값은 비밀번호가 아니라 '어느 Firebase 프로젝트인지' 알려 주는 주소라서 공개 저장소에 올라가도 됩니다.
     실제로 막아 주는 것은 보안 규칙과 입장 코드입니다.

### 2. GitHub (코드 보관)

1. <https://github.com> 가입·로그인 → 오른쪽 위 **+ → New repository**
2. 이름 `ggoolcha-storage`, **Public** → **Create repository**
3. **uploading an existing file** → `index.html`, `firestore.rules`, `README.md` 끌어다 놓기 → **Commit changes**

### 3. Vercel (주소 만들기)

1. <https://vercel.com> → **Sign Up → Continue with GitHub** (Hobby 무료 요금제)
2. **Add New… → Project** → `ggoolcha-storage` 저장소 옆 **Import**
3. Framework Preset은 **Other** 그대로, 다른 설정 없이 **Deploy**
4. 1분쯤 뒤 `https://ggoolcha-storage.vercel.app` 같은 주소가 생깁니다. 이 주소와 입장 코드를 동아리원에게 나눠 주면 끝입니다.
5. (권장) Firebase **Authentication → 설정 → 승인된 도메인 → 도메인 추가**에 위 주소의 도메인(`ggoolcha-storage.vercel.app`)을 넣어 둡니다.

### 4. 사진 자동 입력

따로 설정할 것이 없습니다. (예전 Gemini 방식의 `GEMINI_API_KEY` 환경 변수는 이제 쓰지 않으니 지워도 됩니다.)

## 운영 메모

- **고칠 때**: `src/app.html`을 고치고 `python3 src/build.py`로 `index.html`을 다시 만든 뒤 GitHub에 올리면 Vercel이 자동으로 다시 배포합니다.
- **입장 코드 바꾸기**: Firestore `config/club`의 `code` 값 수정. 이미 들어온 기기는 계속 쓸 수 있습니다.
- **모든 기기 내보내기**: Firestore `members` 컬렉션의 문서를 지우면 다음 접속 때 코드를 다시 묻습니다.
- **무료 한도(Spark 요금제)**: 저장 1GiB, 하루 읽기 5만 건·쓰기 2만 건. 동아리 규모에서는 충분합니다.
- **배송 문구 붙여 넣기**는 사진과 같은 규칙으로 읽어서 배포 버전에서도 됩니다. **재고 질문 AI**는 claude.ai 버전에만 있습니다.
- **사진 읽기가 틀릴 때**: 화면을 확대해서 캡처하거나 필요한 부분만 잘라 넣으면 잘 읽힙니다. 자동으로 채운 값은 저장 전에 꼭 확인하세요.
