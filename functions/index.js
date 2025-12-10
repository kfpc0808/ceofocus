/**
 * Firebase Functions for 기업 지원사업 AI 매칭
 * 기존 Netlify Functions를 Firebase 형식으로 변환
 * v2.1 - 15개 전체 분석 강제, 프롬프트 강화 (2024-11-30)
 * v3.0 - 서버 필터링 도입, 15개 기준 삭제, 최대 50개 요약분석 (2025-12-08)
 * v2.2 - 캐싱 시스템 추가 (2024-12-02)
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const fetch = require('node-fetch');

admin.initializeApp();

// ============================================================
// 일일 사용 제한 헬퍼 함수
// ============================================================

// 한국 시간 기준 오늘 날짜 구하기
function getKoreanToday() {
  const now = new Date();
  const koreaTime = new Date(now.getTime() + (9 * 60 * 60 * 1000)); // UTC + 9시간
  return koreaTime.toISOString().split('T')[0]; // "2025-12-03"
}

// 무제한 사용자 여부 확인 (관리자/무료사용자)
// ★ 무료사용자의 경우 개별 제한(summaryLimit, detailLimit) 반환
async function isUnlimitedUser(userId) {
  try {
    // 🔥 하드코딩된 무료사용자 userId 목록
    const hardcodedFreeUsers = ['admin', 'kfpcenter'];
    
    // ★★★ Firebase Auth UID를 실제 사용자 아이디로 변환 ★★★
    // context.auth.uid는 Firebase Auth UID이므로, 이메일에서 실제 userId 추출
    let actualUserId = userId;
    try {
      const userRecord = await admin.auth().getUser(userId);
      if (userRecord.email && userRecord.email.includes('@')) {
        actualUserId = userRecord.email.split('@')[0];
        console.log(`🔄 UID → userId 변환: ${userId} → ${actualUserId}`);
      }
    } catch (authError) {
      console.log(`⚠️ Auth 조회 실패, 원본 userId 사용: ${userId}`);
    }
    
    // 1. admins 컬렉션에서 확인 (실제 userId 필드로 쿼리)
    const adminsQuery = await admin.firestore().collection('admins')
      .where('userId', '==', actualUserId)
      .limit(1)
      .get();
    
    if (!adminsQuery.empty) {
      const data = adminsQuery.docs[0].data();
      const role = data.role || '';
      
      // 최고관리자, 일반관리자는 무조건 무제한
      if (role === 'super_admin' || role === 'admin') {
        console.log(`✅ 관리자 확인됨: ${data.userId} (${role})`);
        return { unlimited: true, reason: '관리자' };
      }
      
      // 무료사용자는 유효기간 확인 + 개별 제한 적용
      if (role === 'freeuser') {
        const expireDate = data.expireDate;
        // ★ 개별 제한 값 (없으면 기본값 999 = 사실상 무제한)
        const summaryLimit = data.summaryLimit !== undefined ? data.summaryLimit : 999;
        const detailLimit = data.detailLimit !== undefined ? data.detailLimit : 999;
        
        // 유효기간이 null이면 무제한 (개별 제한 적용)
        if (!expireDate) {
          const hasCustom = summaryLimit !== 999 || detailLimit !== 999;
          console.log(`✅ 무료사용자(무제한): ${data.userId}`);
          console.log(`   📊 요약제한: ${summaryLimit}, 상세제한: ${detailLimit}, hasCustomLimit: ${hasCustom}`);
          return { 
            unlimited: true, 
            reason: '무료사용자(무제한)',
            summaryLimit: summaryLimit,
            detailLimit: detailLimit,
            hasCustomLimit: hasCustom
          };
        }
        
        // 유효기간 비교
        const today = getKoreanToday();
        if (expireDate >= today) {
          const hasCustom = summaryLimit !== 999 || detailLimit !== 999;
          console.log(`✅ 무료사용자(유효): ${data.userId}, 만료일: ${expireDate}`);
          console.log(`   📊 요약제한: ${summaryLimit}, 상세제한: ${detailLimit}, hasCustomLimit: ${hasCustom}`);
          return { 
            unlimited: true, 
            reason: `무료사용자(~${expireDate})`,
            summaryLimit: summaryLimit,
            detailLimit: detailLimit,
            hasCustomLimit: hasCustom
          };
        } else {
          console.log(`⚠️ 무료사용자(만료): ${data.userId}, 만료일: ${expireDate}`);
          return { unlimited: false, reason: '무료사용자 기간 만료' };
        }
      }
    }
    
    // 2. 기본 admin 계정 체크 (하드코딩된 admin)
    // 🔥 하드코딩된 무료사용자 목록 체크 (actualUserId 기준)
    if (hardcodedFreeUsers.includes(actualUserId)) {
      console.log(`✅ 하드코딩된 무료사용자: ${actualUserId}`);
      return { unlimited: true, reason: '무료사용자(하드코딩)' };
    }
    
    const usersDoc = await admin.firestore().collection('users').doc(userId).get();
    if (usersDoc.exists) {
      const userData = usersDoc.data();
      
      if (userData.userId === 'admin' || userData.isAdmin === true) {
        console.log(`✅ 관리자 확인됨 (users): ${userData.userId}`);
        return { unlimited: true, reason: '관리자' };
      }
    }
    
    return { unlimited: false, reason: '일반 사용자' };
    
  } catch (error) {
    console.error('무제한 사용자 확인 오류:', error);
    return { unlimited: false, reason: '확인 오류' };
  }
}

// 일일 사용 제한 체크
async function checkDailyLimit(userId, type, limit = 10) {
  const today = getKoreanToday();
  const docRef = admin.firestore().collection('userUsage').doc(userId);
  
  const doc = await docRef.get();
  const data = doc.exists ? doc.data() : {};
  
  // 날짜가 바뀌었으면 카운트 초기화
  if (data.date !== today) {
    await docRef.set({ 
      date: today, 
      summaryCount: 0, 
      detailCount: 0 
    });
    return { allowed: true, count: 0, remaining: limit };
  }
  
  // 현재 사용 횟수 확인
  const field = type === 'summary' ? 'summaryCount' : 'detailCount';
  const currentCount = data[field] || 0;
  
  if (currentCount >= limit) {
    return { allowed: false, count: currentCount, remaining: 0 };
  }
  
  return { allowed: true, count: currentCount, remaining: limit - currentCount };
}

// 사용 횟수 증가
async function incrementDailyUsage(userId, type) {
  const today = getKoreanToday();
  const docRef = admin.firestore().collection('userUsage').doc(userId);
  const field = type === 'summary' ? 'summaryCount' : 'detailCount';
  
  await docRef.set({
    date: today,
    [field]: admin.firestore.FieldValue.increment(1)
  }, { merge: true });
}

// 환경변수에서 API 키 가져오기
// firebase functions:config:set gemini.apikey="YOUR_KEY" bizinfo.apikey="YOUR_KEY"
const getGeminiApiKey = () => functions.config().gemini?.apikey || process.env.GEMINI_API_KEY;
const getBizinfoApiKey = () => functions.config().bizinfo?.apikey || process.env.BIZINFO_API_KEY;

// ============================================================
// 1. getBizInfoPrograms - 기업마당 API 연동
// ============================================================
exports.getBizInfoPrograms = functions
  .region('asia-northeast3')
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {
    try {
      const BIZINFO_API_KEY = getBizinfoApiKey();
      
      if (!BIZINFO_API_KEY) {
        throw new Error('BIZINFO_API_KEY 환경변수가 설정되지 않았습니다.');
      }

      const {
        category = '',
        region = '',
        searchCnt = '500',
        pageUnit = '100',
        pageIndex = '1'
      } = data || {};

      console.log('📡 기업마당 API 호출 시작...');

      // 기업마당 API URL 구성
      let apiUrl = `https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do?crtfcKey=${BIZINFO_API_KEY}&dataType=json`;
      apiUrl += `&searchCnt=${searchCnt}`;
      
      if (category) {
        apiUrl += `&searchLclasId=${category}`;
      }
      if (region) {
        apiUrl += `&hashtags=${encodeURIComponent(region)}`;
      }
      apiUrl += `&pageUnit=${pageUnit}&pageIndex=${pageIndex}`;

      console.log('🔗 API URL:', apiUrl.replace(BIZINFO_API_KEY, '***'));

      const response = await fetch(apiUrl);

      if (!response.ok) {
        throw new Error(`기업마당 API 오류: ${response.status} ${response.statusText}`);
      }

      const text = await response.text();
      console.log('📥 응답 길이:', text.length);
      
      let apiData;
      try {
        apiData = JSON.parse(text);
      } catch (parseError) {
        console.error('JSON 파싱 실패, 응답 시작:', text.substring(0, 200));
        throw new Error('기업마당 API 응답이 JSON 형식이 아닙니다.');
      }

      // 응답 데이터 파싱
      let programs = [];

      if (apiData && apiData.jsonArray && apiData.jsonArray.item) {
        programs = Array.isArray(apiData.jsonArray.item) ? apiData.jsonArray.item : [apiData.jsonArray.item];
        console.log('📦 jsonArray.item 구조 확인');
      } else if (apiData && apiData.jsonArray && Array.isArray(apiData.jsonArray)) {
        programs = apiData.jsonArray;
        console.log('📦 jsonArray 배열 구조 확인');
      } else if (apiData && Array.isArray(apiData)) {
        programs = apiData;
        console.log('📦 배열 구조 확인');
      } else if (apiData && apiData.items) {
        programs = apiData.items;
        console.log('📦 items 구조 확인');
      } else {
        console.log('⚠️ 알 수 없는 응답 구조:', Object.keys(apiData || {}));
      }

      console.log(`✅ 기업마당 API 응답: ${programs.length}개 공고`);

      // 데이터 정규화
      const normalizedPrograms = programs.map((item, index) => ({
        id: item.pblancId || item.seq || `bizinfo-${index}`,
        name: item.pblancNm || item.title || '',
        organization: item.jrsdInsttNm || item.author || '',
        executor: item.excInsttNm || '',
        category: item.pldirSportRealmLclasCodeNm || item.lcategory || '',
        target: item.trgetNm || '',
        description: item.bsnsSumryCn || item.description || '',
        applicationMethod: item.reqstMthPapersCn || '',
        contact: item.refrncNm || '',
        applicationUrl: item.rceptEngnHmpgUrl || '',
        detailUrl: item.pblancUrl || item.link || '',
        applicationPeriod: item.reqstBeginEndDe || item.reqstDt || '',
        registeredDate: item.creatPnttm || item.pubDate || '',
        hashTags: item.hashTags || '',
        views: parseInt(item.inqireCo) || 0,
        attachmentUrl: item.flpthNm || '',
        attachmentName: item.fileNm || '',
        printFileUrl: item.printFlpthNm || '',
        printFileName: item.printFileNm || ''
      }));

      // 신청기간 파싱
      normalizedPrograms.forEach(program => {
        if (program.applicationPeriod) {
          const periods = program.applicationPeriod.split('~').map(s => s.trim());
          if (periods.length === 2) {
            program.applicationStart = periods[0];
            program.applicationEnd = periods[1];
            
            const today = new Date();
            const endDate = new Date(
              periods[1].substring(0, 4) + '-' + 
              periods[1].substring(4, 6) + '-' + 
              periods[1].substring(6, 8)
            );
            program.isOpen = endDate >= today;
          }
        }
      });

      // 통계 정보
      const stats = {
        total: normalizedPrograms.length,
        byCategory: {},
        openCount: normalizedPrograms.filter(p => p.isOpen).length
      };

      normalizedPrograms.forEach(p => {
        const cat = p.category || '기타';
        stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;
      });

      console.log('📊 분야별 통계:', stats.byCategory);

      return {
        success: true,
        totalCount: normalizedPrograms.length,
        stats: stats,
        programs: normalizedPrograms,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('❌ 기업마당 API 오류:', error);
      return {
        success: false,
        error: error.message,
        programs: [],
        timestamp: new Date().toISOString()
      };
    }
  });

// ============================================================
// 1-1. 서버 필터링 함수 - 기업 맞춤 공고 필터링 (v3.0)
// ============================================================

/**
 * 권역 매핑 테이블
 */
const REGION_GROUPS = {
  '수도권': ['서울', '경기', '인천'],
  '충청권': ['대전', '세종', '충북', '충남'],
  '호남권': ['광주', '전북', '전남'],
  '영남권': ['부산', '대구', '울산', '경북', '경남'],
  '강원권': ['강원'],
  '제주권': ['제주']
};

/**
 * 전국 부처 목록
 */
const NATIONAL_ORGANIZATIONS = [
  '중소벤처기업부', '산업통상자원부', '과학기술정보통신부', '고용노동부',
  '농림축산식품부', '해양수산부', '환경부', '국토교통부', '문화체육관광부',
  '보건복지부', '여성가족부', '기획재정부', '행정안전부', '교육부',
  '중소기업청', '특허청', '조달청', '통계청', '관세청', '병무청',
  '소상공인시장진흥공단', '중소벤처기업진흥공단', '한국산업기술진흥원',
  '정보통신산업진흥원', '한국콘텐츠진흥원', '창업진흥원', '기술보증기금',
  '신용보증기금', '한국무역보험공사', 'KOTRA', '대한무역투자진흥공사'
];

/**
 * 업종 키워드 → KSIC 카테고리 매핑
 */
const INDUSTRY_KEYWORDS = {
  // 제조업 관련
  '제조': ['10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32', '33'],
  '제조업': ['10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32', '33'],
  '제조기업': ['10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32', '33'],
  
  // IT/ICT 관련
  'ICT': ['58', '59', '60', '61', '62', '63'],
  'IT': ['58', '59', '60', '61', '62', '63'],
  'SW': ['62', '63'],
  '소프트웨어': ['62', '63'],
  '정보통신': ['61', '62', '63'],
  '디지털': ['58', '59', '60', '61', '62', '63'],
  '디지털콘텐츠': ['58', '59', '63'],
  
  // 콘텐츠 관련
  '콘텐츠': ['58', '59', '60', '63', '90'],
  '문화콘텐츠': ['58', '59', '60', '90'],
  '게임': ['58', '62', '63'],
  '영상': ['59', '60'],
  '방송': ['60'],
  '출판': ['58'],
  
  // 바이오/의료 관련
  '바이오': ['21', '72'],
  '제약': ['21'],
  '의약품': ['21'],
  '의료기기': ['27'],
  '헬스케어': ['21', '27', '86'],
  '보건': ['86'],
  
  // 농림어업
  '농업': ['01'],
  '농기계': ['01', '29'],
  '농어업': ['01', '03'],
  '어업': ['03'],
  '수산': ['03'],
  '임업': ['02'],
  
  // 가구/목재
  '가구': ['32'],
  '가구제품': ['32'],
  '목재': ['16', '32'],
  
  // 서비스업
  '관광': ['55', '79'],
  '여행': ['79'],
  '숙박': ['55'],
  '음식': ['56'],
  '요식': ['56'],
  
  // 기타
  '건설': ['41', '42'],
  '물류': ['49', '52'],
  '운송': ['49', '50', '51'],
  '환경': ['37', '38', '39'],
  '친환경': ['37', '38', '39'],
  '에너지': ['35'],
  '신재생': ['35'],
  '스포츠': ['93'],
  '교육': ['85'],
  '뿌리산업': ['24', '25', '28', '29'],
  '금형': ['25', '29'],
  '주조': ['24', '25'],
  '용접': ['25', '28'],
  '표면처리': ['25'],
  '열처리': ['25'],
  '소성가공': ['25', '29'],
  '디자인': ['74'],
  '연구개발': ['70', '71', '72']
};

/**
 * KSIC 코드 → 업종 카테고리 매핑 (확장)
 */
const KSIC_CATEGORY_MAP = {
  '01': '농업', '02': '임업', '03': '어업',
  '05': '광업', '06': '광업', '07': '광업', '08': '광업',
  '10': '식품제조', '11': '음료제조', '12': '담배', '13': '섬유', '14': '의류',
  '15': '가죽', '16': '목재', '17': '종이', '18': '인쇄', '19': '석유화학',
  '20': '화학', '21': '의약품', '22': '고무플라스틱', '23': '비금속광물',
  '24': '금속', '25': '금속가공', '26': '전자부품', '27': '의료기기',
  '28': '전기장비', '29': '기계장비', '30': '자동차', '31': '운송장비',
  '32': '가구', '33': '기타제조',
  '35': '전기가스', '36': '수도', '37': '하수처리', '38': '폐기물', '39': '환경복원',
  '41': '건축', '42': '토목',
  '45': '자동차판매', '46': '도매', '47': '소매',
  '49': '육상운송', '50': '수상운송', '51': '항공운송', '52': '창고물류',
  '55': '숙박', '56': '음식점',
  '58': '출판', '59': '영상제작', '60': '방송', '61': '통신',
  '62': '소프트웨어', '63': '정보서비스',
  '64': '금융', '65': '보험', '66': '금융서비스',
  '68': '부동산',
  '70': '본사', '71': '건축설계', '72': '연구개발', '73': '광고',
  '74': '디자인', '75': '수의업',
  '77': '임대', '78': '고용', '79': '여행', '80': '경비', '81': '시설관리', '82': '사업지원',
  '84': '공공행정', '85': '교육', '86': '보건', '87': '사회복지',
  '90': '문화예술', '91': '도서관', '93': '스포츠', '94': '협회',
  '95': '수리', '96': '개인서비스', '97': '가사', '99': '국제기관'
};

/**
 * 공고 텍스트에서 지역 추출
 */
function extractProgramRegions(program) {
  const text = `${program.name || ''} ${program.target || ''} ${program.description || ''} ${program.executor || ''} ${program.organization || ''} ${program.hashTags || ''}`.toLowerCase();
  const regions = [];
  let isNational = false;
  let warningRegion = false;
  
  // 1. 전국 키워드 체크
  if (text.includes('전국') || text.includes('전 지역') || text.includes('전지역') || text.includes('대한민국 전역')) {
    isNational = true;
  }
  
  // 2. 권역 체크 (지역 명시가 있으면 전국보다 우선)
  for (const [groupName, groupRegions] of Object.entries(REGION_GROUPS)) {
    const groupNameLower = groupName.toLowerCase();
    if (text.includes(groupNameLower) || text.includes(groupName)) {
      regions.push(...groupRegions);
      isNational = false; // 권역 명시되면 전국 아님
    }
  }
  
  // 3. 개별 지역 체크
  const regionNames = [
    { full: '서울특별시', short: '서울', variations: ['서울시', '서울 소재', '서울소재'] },
    { full: '부산광역시', short: '부산', variations: ['부산시', '부산 소재', '부산소재'] },
    { full: '대구광역시', short: '대구', variations: ['대구시', '대구 소재', '대구소재'] },
    { full: '인천광역시', short: '인천', variations: ['인천시', '인천 소재', '인천소재'] },
    { full: '광주광역시', short: '광주', variations: ['광주시', '광주 소재', '광주소재'] },
    { full: '대전광역시', short: '대전', variations: ['대전시', '대전 소재', '대전소재'] },
    { full: '울산광역시', short: '울산', variations: ['울산시', '울산 소재', '울산소재'] },
    { full: '세종특별자치시', short: '세종', variations: ['세종시', '세종 소재', '세종소재'] },
    { full: '경기도', short: '경기', variations: ['경기 소재', '경기소재', '경기지역', '경기도내'] },
    { full: '강원도', short: '강원', variations: ['강원 소재', '강원소재', '강원지역', '강원도내', '강원특별자치도'] },
    { full: '충청북도', short: '충북', variations: ['충북 소재', '충북소재', '충청북도내'] },
    { full: '충청남도', short: '충남', variations: ['충남 소재', '충남소재', '충청남도내'] },
    { full: '전라북도', short: '전북', variations: ['전북 소재', '전북소재', '전라북도내', '전북특별자치도'] },
    { full: '전라남도', short: '전남', variations: ['전남 소재', '전남소재', '전라남도내'] },
    { full: '경상북도', short: '경북', variations: ['경북 소재', '경북소재', '경상북도내'] },
    { full: '경상남도', short: '경남', variations: ['경남 소재', '경남소재', '경상남도내'] },
    { full: '제주특별자치도', short: '제주', variations: ['제주 소재', '제주소재', '제주도', '제주지역'] }
  ];
  
  for (const region of regionNames) {
    const allVariations = [region.full.toLowerCase(), region.short.toLowerCase(), ...region.variations.map(v => v.toLowerCase())];
    for (const variation of allVariations) {
      if (text.includes(variation)) {
        if (!regions.includes(region.short)) {
          regions.push(region.short);
        }
        isNational = false;
      }
    }
  }
  
  // 4. 복수지역 표현 파싱 (서울·경기, 부산/울산 등)
  const multiRegionPatterns = [
    /([가-힣]+)[·\/,\s]+([가-힣]+)(?:[·\/,\s]+([가-힣]+))?(?:\s*(?:지역|소재|기업|업체))/g
  ];
  
  for (const pattern of multiRegionPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      for (let i = 1; i <= 3; i++) {
        if (match[i]) {
          const regionShort = match[i].replace(/특별시|광역시|도|시/g, '');
          for (const region of regionNames) {
            if (region.short === regionShort || region.full.includes(regionShort)) {
              if (!regions.includes(region.short)) {
                regions.push(region.short);
              }
            }
          }
        }
      }
    }
  }
  
  // 5. 수행기관에서 지역 추출 (예: 경북테크노파크 → 경북)
  const executor = (program.executor || '').toLowerCase();
  for (const region of regionNames) {
    if (executor.includes(region.short.toLowerCase()) || executor.includes(region.full.toLowerCase())) {
      if (!regions.includes(region.short)) {
        regions.push(region.short);
      }
      isNational = false;
    }
  }
  
  // 6. 한자 표현 인식 (素材 = 소재)
  if (text.includes('素材') || text.includes('所在')) {
    // 이미 위에서 처리됨
  }
  
  // 7. 전국 부처인지 확인
  const isNationalOrg = NATIONAL_ORGANIZATIONS.some(org => 
    text.includes(org.toLowerCase()) || (program.organization || '').includes(org)
  );
  
  // 8. 최종 판단
  if (regions.length === 0) {
    if (isNational || isNationalOrg) {
      return { regions: ['전국'], isNational: true, warningRegion: false };
    } else {
      // 지역 감지 실패
      return { regions: ['전국'], isNational: true, warningRegion: true };
    }
  }
  
  return { regions: [...new Set(regions)], isNational: false, warningRegion: false };
}

/**
 * 공고 텍스트에서 업종 제한 추출
 */
function extractProgramIndustry(program) {
  const text = `${program.name || ''} ${program.target || ''} ${program.description || ''} ${program.hashTags || ''}`;
  const industries = [];
  let warningIndustry = false;
  let restrictedKsicPrefixes = [];
  
  // 1. 명시적 업종 제한 키워드 체크
  const restrictionPatterns = [
    /([가-힣A-Za-z]+)\s*(?:기업|업체|업종|분야)\s*(?:만|전용|한정|대상)/g,
    /([가-힣A-Za-z]+)\s*(?:만|전용)\s*(?:지원|신청|가능)/g
  ];
  
  for (const [keyword, ksicPrefixes] of Object.entries(INDUSTRY_KEYWORDS)) {
    const keywordLower = keyword.toLowerCase();
    const textLower = text.toLowerCase();
    
    // "OO 기업만", "OO 전용", "OO 대상" 패턴 체크
    const restrictionRegex = new RegExp(`${keyword}\\s*(?:기업|업체|업종)?\\s*(?:만|전용|한정|대상|에\\s*한)`, 'i');
    if (restrictionRegex.test(text)) {
      industries.push(keyword);
      restrictedKsicPrefixes.push(...ksicPrefixes);
    }
  }
  
  // 🔥 1-2. 공고명에 특정 업종 키워드 포함 시 해당 업종으로 제한
  const programName = (program.name || '').toLowerCase();
  const targetText = (program.target || '').toLowerCase();
  
  const titleIndustryKeywords = {
    '가구': ['32'],
    '어업': ['03'],
    '어업인': ['03'],
    '어업활동': ['03'],
    '어업경영체': ['03'],
    '수산': ['03'],
    '수산업': ['03'],
    '농업': ['01'],
    '농가': ['01'],
    '농업인': ['01'],
    '축산': ['01'],
    '축산업': ['01'],
    '임업': ['02'],
    '임업인': ['02']
  };
  
  for (const [keyword, ksicPrefixes] of Object.entries(titleIndustryKeywords)) {
    // 공고명이나 지원대상에 업종 키워드가 포함되면 해당 업종으로 제한
    if (programName.includes(keyword) || targetText.includes(keyword)) {
      if (!industries.includes(keyword)) {
        industries.push(keyword);
        restrictedKsicPrefixes.push(...ksicPrefixes);
      }
    }
  }
  
  // 2. 모호한 업종 표현 체크
  const ambiguousKeywords = ['혁신기업', '혁신성장', '스타트업', '벤처', '디지털 전환', '스마트'];
  for (const keyword of ambiguousKeywords) {
    if (text.includes(keyword)) {
      warningIndustry = true;
    }
  }
  
  // 3. 결과 반환
  if (industries.length === 0) {
    return { industries: [], restrictedKsicPrefixes: [], isRestricted: false, warningIndustry };
  }
  
  return {
    industries,
    restrictedKsicPrefixes: [...new Set(restrictedKsicPrefixes)],
    isRestricted: true,
    warningIndustry
  };
}

/**
 * 공고 텍스트에서 기업규모 제한 추출
 */
function extractProgramCompanySize(program) {
  const text = `${program.name || ''} ${program.target || ''} ${program.description || ''}`.toLowerCase();
  
  // 소기업 전용
  if (/소기업\s*(?:만|전용|한정|대상)/.test(text) || /소기업에\s*한/.test(text)) {
    return { allowedSizes: ['소기업'], isRestricted: true };
  }
  
  // 중기업 전용
  if (/중기업\s*(?:만|전용|한정|대상)/.test(text) || /중기업에\s*한/.test(text)) {
    return { allowedSizes: ['중기업'], isRestricted: true };
  }
  
  // 중견기업 전용
  if (/중견기업\s*(?:만|전용|한정|대상)/.test(text) || /중견기업에\s*한/.test(text)) {
    return { allowedSizes: ['중견기업'], isRestricted: true };
  }
  
  // 중소기업 (소기업 + 중기업)
  if (text.includes('중소기업')) {
    return { allowedSizes: ['소기업', '중기업', '중소기업'], isRestricted: true };
  }
  
  // 제한 없음
  return { allowedSizes: [], isRestricted: false };
}

/**
 * 공고 텍스트에서 업력 제한 추출
 */
function extractProgramBusinessAge(program) {
  const text = `${program.name || ''} ${program.target || ''} ${program.description || ''}`;
  
  // 창업 N년 이내
  const withinMatch = text.match(/창업\s*(\d+)년\s*이내/);
  if (withinMatch) {
    return { maxAge: parseInt(withinMatch[1]), minAge: null, isRestricted: true };
  }
  
  // N년 미만
  const underMatch = text.match(/(\d+)년\s*미만/);
  if (underMatch) {
    return { maxAge: parseInt(underMatch[1]) - 1, minAge: null, isRestricted: true };
  }
  
  // 업력 N년 이상
  const overMatch = text.match(/업력\s*(\d+)년\s*이상/);
  if (overMatch) {
    return { maxAge: null, minAge: parseInt(overMatch[1]), isRestricted: true };
  }
  
  // 설립 N년 이상
  const establishMatch = text.match(/설립\s*(\d+)년\s*이상/);
  if (establishMatch) {
    return { maxAge: null, minAge: parseInt(establishMatch[1]), isRestricted: true };
  }
  
  // 예비창업자
  if (text.includes('예비창업') || text.includes('창업예정')) {
    return { maxAge: 0, minAge: null, isRestricted: true, preStartup: true };
  }
  
  return { maxAge: null, minAge: null, isRestricted: false };
}

/**
 * 공고 텍스트에서 인증 조건 추출
 */
function extractProgramCertRequirements(program) {
  const text = `${program.name || ''} ${program.target || ''} ${program.description || ''}`;
  const requirements = [];
  
  if (/벤처기업\s*(?:필수|만|전용|한정|인증\s*필수)/.test(text) || /벤처\s*인증\s*(?:필수|기업만)/.test(text)) {
    requirements.push('certVenture');
  }
  
  if (/이노비즈\s*(?:필수|만|전용|한정|인증\s*필수)/.test(text)) {
    requirements.push('certInnobiz');
  }
  
  if (/메인비즈\s*(?:필수|만|전용|한정|인증\s*필수)/.test(text)) {
    requirements.push('certMainbiz');
  }
  
  if (/여성기업\s*(?:필수|만|전용|한정)/.test(text) || /여성\s*CEO/.test(text)) {
    requirements.push('certWoman');
  }
  
  if (/사회적기업\s*(?:필수|만|전용|한정)/.test(text) || /사회적경제기업/.test(text)) {
    requirements.push('certSocial');
  }
  
  return { requirements, isRestricted: requirements.length > 0 };
}

/**
 * 기업-공고 매칭 점수 계산
 */
function calculateMatchScore(program, companyData, matchInfo) {
  let score = 50; // 기본 점수
  const reasons = [];
  
  // 지역 매칭 가점
  if (matchInfo.regionMatch === 'exact') {
    score += 20;
    reasons.push('지역 정확 일치');
  } else if (matchInfo.regionMatch === 'national') {
    score += 10;
    reasons.push('전국 대상 사업');
  }
  
  // 업종 매칭 가점
  if (matchInfo.industryMatch === 'exact') {
    score += 15;
    reasons.push('업종 정확 일치');
  } else if (matchInfo.industryMatch === 'general') {
    score += 5;
    reasons.push('업종 제한 없음');
  }
  
  // 기업규모 매칭 가점
  if (matchInfo.sizeMatch === 'exact') {
    score += 10;
    reasons.push('기업규모 일치');
  }
  
  // 인증 보유 가점
  if (companyData?.certVenture === 'Y') score += 3;
  if (companyData?.certInnobiz === 'Y') score += 2;
  if (companyData?.certMainbiz === 'Y') score += 2;
  
  // 점수 범위 제한
  score = Math.max(0, Math.min(100, score));
  
  return { score, reasons };
}

/**
 * 메인 필터링 함수 - 기업에 맞는 공고만 필터링
 * @param {Array} allPrograms - 전체 공고 목록
 * @param {Object} companyData - 기업 정보
 * @returns {Object} - 필터링된 공고 목록과 통계
 */
function filterProgramsByCompany(allPrograms, companyData) {
  console.log(`🔍 필터링 시작: 전체 ${allPrograms.length}개 공고`);
  
  const companyRegion = (companyData?.locationSido || '').replace(/특별시|광역시|도/g, '');
  const companyKsicPrefix = (companyData?.ksicCode || '').substring(0, 2);
  const companySize = companyData?.companySize || '';
  const companyAge = companyData?.businessAge || 0;
  
  // KSIC 유효성 체크
  const ksicWarning = !companyKsicPrefix || companyKsicPrefix.length < 2;
  if (ksicWarning) {
    console.log('⚠️ KSIC 코드 없음 또는 비정상');
  }
  
  const results = [];
  const excluded = {
    closed: 0,   // 🆕 신청기간 종료
    region: 0,
    industry: 0,
    size: 0,
    age: 0,
    cert: 0
  };
  
  for (const program of allPrograms) {
    let isExcluded = false;
    let excludeReason = '';
    const matchInfo = {
      regionMatch: 'none',
      industryMatch: 'none',
      sizeMatch: 'none'
    };
    
    // ========== 0순위: 신청기간 종료 필터링 (가장 먼저!) ==========
    // isOpen 플래그로 체크
    if (program.isOpen === false) {
      excluded.closed++;
      continue;  // 마감된 공고는 즉시 스킵
    }
    
    // applicationEnd 날짜로 직접 체크 (isOpen이 없는 경우 대비)
    if (program.applicationEnd) {
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const endDateStr = program.applicationEnd.replace(/[^0-9]/g, ''); // 숫자만 추출
        if (endDateStr.length >= 8) {
          const endDate = new Date(
            endDateStr.substring(0, 4) + '-' + 
            endDateStr.substring(4, 6) + '-' + 
            endDateStr.substring(6, 8)
          );
          if (endDate < today) {
            excluded.closed++;
            continue;  // 신청기간 종료된 공고 스킵
          }
        }
      } catch (e) {
        // 날짜 파싱 실패시 통과 (안전하게 처리)
      }
    }
    
    // ========== 1순위: 지역 필터링 ==========
    const regionInfo = extractProgramRegions(program);
    
    if (!regionInfo.isNational) {
      // 지역 제한이 있는 공고
      if (companyRegion && !regionInfo.regions.includes(companyRegion)) {
        isExcluded = true;
        excludeReason = `지역 불일치 (공고: ${regionInfo.regions.join(', ')} / 기업: ${companyRegion})`;
        excluded.region++;
      } else if (companyRegion && regionInfo.regions.includes(companyRegion)) {
        matchInfo.regionMatch = 'exact';
      }
    } else {
      matchInfo.regionMatch = 'national';
    }
    
    if (isExcluded) continue;
    
    // ========== 2순위: 업종 필터링 ==========
    const industryInfo = extractProgramIndustry(program);
    
    if (industryInfo.isRestricted && !ksicWarning) {
      // 업종 제한이 있는 공고
      if (!industryInfo.restrictedKsicPrefixes.includes(companyKsicPrefix)) {
        isExcluded = true;
        excludeReason = `업종 불일치 (공고: ${industryInfo.industries.join(', ')} / 기업 KSIC: ${companyKsicPrefix})`;
        excluded.industry++;
      } else {
        matchInfo.industryMatch = 'exact';
      }
    } else {
      matchInfo.industryMatch = 'general';
    }
    
    if (isExcluded) continue;
    
    // ========== 3순위: 기업규모 필터링 ==========
    const sizeInfo = extractProgramCompanySize(program);
    
    if (sizeInfo.isRestricted && companySize) {
      if (!sizeInfo.allowedSizes.some(s => companySize.includes(s) || s.includes(companySize))) {
        isExcluded = true;
        excludeReason = `기업규모 불일치 (공고: ${sizeInfo.allowedSizes.join(', ')} / 기업: ${companySize})`;
        excluded.size++;
      } else {
        matchInfo.sizeMatch = 'exact';
      }
    } else {
      matchInfo.sizeMatch = 'general';
    }
    
    if (isExcluded) continue;
    
    // ========== 추가: 업력 필터링 ==========
    const ageInfo = extractProgramBusinessAge(program);
    
    if (ageInfo.isRestricted) {
      if (ageInfo.preStartup && companyAge > 0) {
        isExcluded = true;
        excludeReason = `예비창업자 대상 (기업 업력: ${companyAge}년)`;
        excluded.age++;
      } else if (ageInfo.maxAge !== null && companyAge > ageInfo.maxAge) {
        isExcluded = true;
        excludeReason = `업력 초과 (공고: ${ageInfo.maxAge}년 이내 / 기업: ${companyAge}년)`;
        excluded.age++;
      } else if (ageInfo.minAge !== null && companyAge < ageInfo.minAge) {
        isExcluded = true;
        excludeReason = `업력 미달 (공고: ${ageInfo.minAge}년 이상 / 기업: ${companyAge}년)`;
        excluded.age++;
      }
    }
    
    if (isExcluded) continue;
    
    // ========== 추가: 인증 조건 필터링 ==========
    const certInfo = extractProgramCertRequirements(program);
    
    if (certInfo.isRestricted) {
      for (const req of certInfo.requirements) {
        if (companyData?.[req] !== 'Y') {
          isExcluded = true;
          excludeReason = `인증 미보유 (필수: ${req})`;
          excluded.cert++;
          break;
        }
      }
    }
    
    if (isExcluded) continue;
    
    // ========== 매칭 성공 - 점수 계산 ==========
    const scoreInfo = calculateMatchScore(program, companyData, matchInfo);
    
    results.push({
      ...program,
      fitScore: scoreInfo.score,
      matchReasons: scoreInfo.reasons,
      warningRegion: regionInfo.warningRegion,
      warningIndustry: industryInfo.warningIndustry || ksicWarning,
      programRegions: regionInfo.regions,
      programIndustries: industryInfo.industries
    });
  }
  
  // 점수순 정렬
  results.sort((a, b) => b.fitScore - a.fitScore);
  
  console.log(`✅ 필터링 완료: ${results.length}개 매칭 (제외: 마감 ${excluded.closed}, 지역 ${excluded.region}, 업종 ${excluded.industry}, 규모 ${excluded.size}, 업력 ${excluded.age}, 인증 ${excluded.cert})`);
  
  return {
    matchedPrograms: results,
    totalCount: allPrograms.length,
    matchedCount: results.length,
    excludedStats: excluded,
    companyInfo: {
      region: companyRegion,
      ksicPrefix: companyKsicPrefix,
      size: companySize,
      age: companyAge
    }
  };
}

/**
 * 테스트 케이스 실행 함수
 */
function runFilterTests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🧪 필터링 테스트 시작');
  console.log('═══════════════════════════════════════════════════════════════');
  
  const testResults = [];
  
  // 테스트 1: 서울 기업 → 대전 전용 공고 제외
  const test1 = filterProgramsByCompany(
    [{ name: '대전 중소기업 지원', target: '대전 소재 기업', description: '대전시 관내 기업만' }],
    { locationSido: '서울', ksicCode: '29', companySize: '소기업' }
  );
  testResults.push({ name: '서울→대전 제외', pass: test1.matchedCount === 0 });
  
  // 테스트 2: 제주 기업 → 수도권 공고 제외
  const test2 = filterProgramsByCompany(
    [{ name: '수도권 소상공인', target: '수도권 소재 기업', description: '서울·경기·인천' }],
    { locationSido: '제주', ksicCode: '56', companySize: '소기업' }
  );
  testResults.push({ name: '제주→수도권 제외', pass: test2.matchedCount === 0 });
  
  // 테스트 3: 경기 기업 → 수도권 공고 포함
  const test3 = filterProgramsByCompany(
    [{ name: '수도권 제조업 지원', target: '수도권 제조기업', description: '' }],
    { locationSido: '경기', ksicCode: '29', companySize: '중기업' }
  );
  testResults.push({ name: '경기→수도권 포함', pass: test3.matchedCount === 1 });
  
  // 테스트 4: 제조업 기업 → 농업 전용 공고 제외
  const test4 = filterProgramsByCompany(
    [{ name: '스마트팜 지원', target: '농업 기업만', description: '농업 분야' }],
    { locationSido: '전국', ksicCode: '29', companySize: '소기업' }
  );
  testResults.push({ name: '제조업→농업 제외', pass: test4.matchedCount === 0 });
  
  // 테스트 5: 제조업 기업 → ICT 전용 공고 제외
  const test5 = filterProgramsByCompany(
    [{ name: 'ICT 스타트업 육성', target: 'ICT 기업만', description: 'SW·IT 기업' }],
    { locationSido: '서울', ksicCode: '25', companySize: '소기업' }
  );
  testResults.push({ name: '제조업→ICT 제외', pass: test5.matchedCount === 0 });
  
  // 테스트 6: IT 기업 → ICT 공고 포함
  const test6 = filterProgramsByCompany(
    [{ name: 'ICT 혁신 바우처', target: 'ICT 기업만', description: 'SW 기업 대상' }],
    { locationSido: '서울', ksicCode: '62', companySize: '소기업' }
  );
  testResults.push({ name: 'IT→ICT 포함', pass: test6.matchedCount === 1 });
  
  // 테스트 7: 전국 부처 + 충청권 명시 → 충청권만 통과
  const test7a = filterProgramsByCompany(
    [{ name: '중소벤처기업부 지원', target: '충청권 기업 대상', organization: '중소벤처기업부', description: '' }],
    { locationSido: '대전', ksicCode: '29', companySize: '소기업' }
  );
  const test7b = filterProgramsByCompany(
    [{ name: '중소벤처기업부 지원', target: '충청권 기업 대상', organization: '중소벤처기업부', description: '' }],
    { locationSido: '서울', ksicCode: '29', companySize: '소기업' }
  );
  testResults.push({ name: '전국부처+충청권(대전 포함)', pass: test7a.matchedCount === 1 });
  testResults.push({ name: '전국부처+충청권(서울 제외)', pass: test7b.matchedCount === 0 });
  
  // 테스트 8: 지역 인식 실패 → warningRegion=true
  const test8 = filterProgramsByCompany(
    [{ name: '스마트공장 지원', target: '중소 제조기업', description: '', organization: '알수없는기관' }],
    { locationSido: '경기', ksicCode: '29', companySize: '소기업' }
  );
  testResults.push({ name: '지역 인식 실패 경고', pass: test8.matchedPrograms[0]?.warningRegion === true });
  
  // 테스트 9: 업종 모호 → warningIndustry=true
  const test9 = filterProgramsByCompany(
    [{ name: '혁신기업 성장지원', target: '혁신성장 기업', description: '' }],
    { locationSido: '서울', ksicCode: '29', companySize: '소기업' }
  );
  testResults.push({ name: '업종 모호 경고', pass: test9.matchedPrograms[0]?.warningIndustry === true });
  
  // 테스트 10: KSIC 없음 → 경고
  const test10 = filterProgramsByCompany(
    [{ name: '제조업 R&D', target: '제조업 기업', description: '' }],
    { locationSido: '서울', ksicCode: '', companySize: '소기업' }
  );
  testResults.push({ name: 'KSIC 없음 경고', pass: test10.matchedPrograms[0]?.warningIndustry === true });
  
  // 테스트 11: 소기업 → 중기업 전용 공고 제외
  const test11 = filterProgramsByCompany(
    [{ name: '중기업 성장지원', target: '중기업 대상', description: '중기업만 신청' }],
    { locationSido: '서울', ksicCode: '29', companySize: '소기업' }
  );
  testResults.push({ name: '소기업→중기업 제외', pass: test11.matchedCount === 0 });
  
  // 테스트 12: 업력 3년 → 7년 이상 공고 제외
  const test12 = filterProgramsByCompany(
    [{ name: '성숙기업 지원', target: '업력 7년 이상', description: '' }],
    { locationSido: '서울', ksicCode: '29', companySize: '소기업', businessAge: 3 }
  );
  testResults.push({ name: '업력 3년→7년 제외', pass: test12.matchedCount === 0 });
  
  // 테스트 13: 벤처인증 없음 → 벤처 필수 공고 제외
  const test13 = filterProgramsByCompany(
    [{ name: '벤처 도약 지원', target: '벤처기업 필수', description: '벤처 인증 필수' }],
    { locationSido: '서울', ksicCode: '29', companySize: '소기업', certVenture: 'N' }
  );
  testResults.push({ name: '벤처 없음→벤처 제외', pass: test13.matchedCount === 0 });
  
  // 테스트 14: 복수지역(부산·울산) 인식
  const test14 = filterProgramsByCompany(
    [{ name: '동남권 지원', target: '부산·울산 기업', description: '' }],
    { locationSido: '부산', ksicCode: '29', companySize: '소기업' }
  );
  testResults.push({ name: '부산·울산 복수지역', pass: test14.matchedCount === 1 });
  
  // 테스트 15: 한자 표현 인식
  const test15 = filterProgramsByCompany(
    [{ name: '서울 素材 기업 지원', target: '서울 소재 기업', description: '' }],
    { locationSido: '서울', ksicCode: '29', companySize: '소기업' }
  );
  testResults.push({ name: '한자 표현 인식', pass: test15.matchedCount === 1 });
  
  // 결과 출력
  console.log('');
  let passCount = 0;
  for (const result of testResults) {
    const status = result.pass ? '✅ PASS' : '❌ FAIL';
    console.log(`${status}: ${result.name}`);
    if (result.pass) passCount++;
  }
  
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`📊 결과: ${passCount}/${testResults.length} 통과 (${Math.round(passCount/testResults.length*100)}%)`);
  console.log('═══════════════════════════════════════════════════════════════');
  
  return { total: testResults.length, passed: passCount, results: testResults };
}

// ============================================================
// 2. geminiSummary - Gemini AI 적합성 판단 + 요약분석 (통합)
// ============================================================
exports.geminiSummary = functions
  .region('asia-northeast3')
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onCall(async (data, context) => {
    try {
      // 🆕 로그인 확인
      if (!context.auth) {
        return { success: false, error: '로그인이 필요합니다.' };
      }
      
      const userId = context.auth.uid;
      
      // 🆕 무제한 사용자 여부 확인 (관리자/무료사용자)
      const unlimitedCheck = await isUnlimitedUser(userId);
      
      // 🆕 skipLimitCheck 먼저 추출 (변수 사용 전에 선언 필요)
      const skipLimitCheck = data?.skipLimitCheck || false;
      console.log('📄 skipLimitCheck:', skipLimitCheck);
      
      // 🆕 일일 사용 제한 체크
      let limitCheck = { allowed: true, count: 0, remaining: 999 };
      
      // ★★★ 디버깅 로그 강화 ★★★
      console.log(`📋 [요약분석] 제한 체크 시작 - userId: ${userId}`);
      console.log(`📋 [요약분석] unlimitedCheck:`, JSON.stringify(unlimitedCheck));
      
      // ★ 무료사용자 개별 제한 (summaryLimit이 설정된 경우)
      const hasSummaryLimit = unlimitedCheck.unlimited && 
                              unlimitedCheck.hasCustomLimit && 
                              unlimitedCheck.summaryLimit !== undefined && 
                              unlimitedCheck.summaryLimit !== 999;
      
      console.log(`📋 [요약분석] hasSummaryLimit: ${hasSummaryLimit}, summaryLimit: ${unlimitedCheck.summaryLimit}`);
      
      if (hasSummaryLimit) {
        console.log(`⏳ [요약분석] 무료사용자 제한 체크 - 한도: ${unlimitedCheck.summaryLimit}회`);
        limitCheck = await checkDailyLimit(userId, 'summary', unlimitedCheck.summaryLimit);
        console.log(`📊 [요약분석] 제한 체크 결과:`, JSON.stringify(limitCheck));
        
        if (!limitCheck.allowed) {
          console.log(`❌ [요약분석] 한도 초과! ${limitCheck.count}/${unlimitedCheck.summaryLimit}`);
          return { 
            success: false, 
            error: `일일 요약분석 한도(${unlimitedCheck.summaryLimit}회)를 초과했습니다.\n오늘 사용: ${limitCheck.count}회\n내일 다시 이용해주세요.`,
            limitExceeded: true,
            dailyLimit: unlimitedCheck.summaryLimit,
            dailyUsed: limitCheck.count
          };
        }
        console.log(`🔓 [요약분석] 무료사용자 통과: ${unlimitedCheck.reason}, 사용: ${limitCheck.count}/${unlimitedCheck.summaryLimit}회`);
      } else if (!unlimitedCheck.unlimited) {
        // 일반 사용자는 10회 제한
        console.log(`⏳ [요약분석] 일반 사용자 제한 체크 - 한도: 10회`);
        limitCheck = await checkDailyLimit(userId, 'summary', 10);
        console.log(`📊 [요약분석] 제한 체크 결과:`, JSON.stringify(limitCheck));
        
        if (!limitCheck.allowed) {
          console.log(`❌ [요약분석] 한도 초과! ${limitCheck.count}/10`);
          return { 
            success: false, 
            error: `일일 요약분석 한도(10회)를 초과했습니다.\n오늘 사용: ${limitCheck.count}회\n내일 다시 이용해주세요.`,
            limitExceeded: true,
            dailyLimit: 10,
            dailyUsed: limitCheck.count
          };
        }
      } else {
        console.log(`🔓 [요약분석] 무제한 사용자(제한없음): ${unlimitedCheck.reason}`);
      }
      
      const GEMINI_API_KEY = getGeminiApiKey();
      
      if (!GEMINI_API_KEY) {
        console.error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다.');
        return { success: false, error: 'API 키가 설정되지 않았습니다.' };
      }

      const { companyData, programs: rawPrograms } = data || {};

      if (!companyData || !rawPrograms || rawPrograms.length === 0) {
        return { success: false, error: '기업 정보와 프로그램 목록이 필요합니다.' };
      }

      // ========================================
      // 🆕 v3.0: 서버 필터링 적용 (15개 기준 삭제)
      // ========================================
      const filterResult = filterProgramsByCompany(rawPrograms, companyData);
      
      // 매칭 0개 처리 - AI 호출 없이 반환 (포인트 차감 없음)
      if (filterResult.matchedCount === 0) {
        console.log(`📭 매칭 공고 없음 - 사용자: ${userId}`);
        const ksicPrefix = (companyData.ksicCode || '').substring(0, 2);
        return {
          success: true,
          noMatch: true,
          message: '귀사 조건에 맞는 공고가 없습니다.',
          searchConditions: {
            region: filterResult.companyInfo.region || '미입력',
            industry: KSIC_CATEGORY_MAP[ksicPrefix] || '미입력',
            ksicCode: companyData.ksicCode || '미입력',
            size: filterResult.companyInfo.size || '미입력'
          },
          excludedStats: filterResult.excludedStats,
          totalSearched: filterResult.totalCount,
          results: [],
          remaining: unlimitedCheck.unlimited ? 999 : limitCheck.remaining,
          unlimited: unlimitedCheck.unlimited
        };
      }
      
      // 🔥 v3.2: 필터링 통과한 공고 중 상위 20개만 분석 (정확 매칭만)
      const MAX_ANALYSIS_COUNT = 20;
      const programs = filterResult.matchedPrograms.slice(0, MAX_ANALYSIS_COUNT);
      
      console.log(`🤖 AI 분석 시작: ${programs.length}개 공고 (필터링 통과 ${filterResult.matchedCount}개 중 상위 ${programs.length}개) - 사용자: ${userId}`);

      // 업종 대분류 추출 (KSIC 앞 2자리)
      const ksicPrefix = (companyData.ksicCode || '').substring(0, 2);
      const ksicCategoryMap = {
        '01': '농업', '02': '임업', '03': '어업',
        '10': '식품제조', '11': '음료제조', '13': '섬유', '14': '의류',
        '20': '화학', '21': '의약품', '22': '고무플라스틱', '23': '비금속광물',
        '24': '금속', '25': '금속가공', '26': '전자부품', '27': '의료기기',
        '28': '전기장비', '29': '기계장비', '30': '자동차', '31': '운송장비',
        '41': '건설', '42': '토목',
        '45': '자동차판매', '46': '도매', '47': '소매',
        '49': '육상운송', '52': '물류창고',
        '55': '숙박', '56': '음식점',
        '58': '출판', '59': '영상제작', '60': '방송', '61': '통신', '62': '소프트웨어', '63': '정보서비스',
        '64': '금융', '70': '본사', '71': '연구개발', '72': '과학기술서비스', '73': '전문서비스',
        '74': '디자인', '75': '수의업', '79': '여행', '80': '경비', '81': '시설관리',
        '85': '교육', '86': '보건', '87': '사회복지', '90': '문화예술', '91': '스포츠'
      };
      const ksicCategory = ksicCategoryMap[ksicPrefix] || '기타';

      // 업력 계산
      const businessAge = companyData.businessAge || 0;
      
      // 대표자 나이 계산
      let ceoAge = 0;
      if (companyData.ceoBirth) {
        const birthYear = parseInt(companyData.ceoBirth.substring(0, 4));
        ceoAge = new Date().getFullYear() - birthYear;
      }

      // ========================================
      // 상세 프롬프트 생성
      // ========================================
      const prompt = `당신은 대한민국 정부 지원사업 자격요건 심사 전문가입니다.
아래 기업 정보를 바탕으로, 각 공고가 이 기업에 "적합"한지 엄격하게 판단하세요.
부적합한 공고는 반드시 제외하고, 적합한 공고만 요약 분석을 제공하세요.

═══════════════════════════════════════════════════════════════
📌 분석 대상 기업 정보
═══════════════════════════════════════════════════════════════
• 기업명: ${companyData.companyName || '미입력'}
• 소재지: ${companyData.locationSido || '미입력'} ${companyData.locationSigungu || ''}
• 수도권 여부: ${companyData.capitalArea === 'Y' ? '수도권 (서울/경기/인천)' : '비수도권'}
• 기업규모: ${companyData.companySize || '미입력'}
• 업종코드(KSIC): ${companyData.ksicCode || '미입력'} (${ksicCategory})
• 업력: ${businessAge}년 (설립일: ${companyData.establishDate || '미입력'})
• 상시근로자 수: ${companyData.employeesTotal || 0}명
• 최근 매출액: ${companyData.revenueRecent ? Math.round(companyData.revenueRecent / 100000000) + '억원' : '미입력'}
• 대표자 성별: ${companyData.ceoGender === 'M' ? '남성' : companyData.ceoGender === 'F' ? '여성' : '미입력'}
• 대표자 나이: ${ceoAge > 0 ? ceoAge + '세' : '미입력'}
• 벤처기업 인증: ${companyData.certVenture === 'Y' ? '있음' : '없음'}
• 이노비즈 인증: ${companyData.certInnobiz === 'Y' ? '있음' : '없음'}
• 메인비즈 인증: ${companyData.certMainbiz === 'Y' ? '있음' : '없음'}
• 여성기업 인증: ${companyData.certWoman === 'Y' ? '있음' : '없음'}
• 사회적기업 여부: ${companyData.certSocial === 'Y' ? '사회적기업' : '일반기업'}
• 수출기업 여부: ${(companyData.exportRecent && companyData.exportRecent > 0) ? '수출기업 (수출액: ' + companyData.exportRecent + '$)' : '내수기업'}
• 연구조직 보유: ${companyData.researchOrg === 'Y' || companyData.researchOrg === '기업부설연구소' || companyData.researchOrg === '연구개발전담부서' ? '있음' : '없음'}
• 희망 지원분야: ${companyData.supportNeeds?.join(', ') || '전체'}

═══════════════════════════════════════════════════════════════
📌 적합성 판단 기준 (매우 엄격하게 적용)
═══════════════════════════════════════════════════════════════

【1. 지역 조건】 ❗ 가장 중요
다음 패턴이 보이면 해당 지역 기업만 가능:
- "○○지역 소재", "○○ 소재 기업", "○○지역 내"
- "○○도내", "○○시내", "○○권역"
- "[서울·경기·인천]", "[전남]", "[경북]" 등 대괄호 표기
- 사업수행기관에 지역명 포함 (예: "전남정보문화산업진흥원" → 전남 한정)
- "수도권", "비수도권", "지방" 표현

예외: "전국", "전 지역", 중앙부처 직접 운영 (전국 대상)

→ 기업 소재지(${companyData.locationSido})와 불일치하면 "부적합"

【2. 기업 규모 조건】
- "중기업", "중기업 대상" → 소기업 부적합
- "소기업 전용", "소기업만" → 중기업/중견기업 부적합
- "중견기업", "중견기업 전용" → 소기업/중기업 부적합
- "대기업" → 중소기업 부적합
- "중소기업" → 중견기업/대기업 부적합

→ 기업 규모(${companyData.companySize})와 불일치하면 "부적합"

【3. 업종 조건】
- "제조업", "제조기업", "제조업체" → 비제조업 부적합
- "농업", "농기계", "농어업" → 농업 외 부적합
- "수산업", "어업", "수산물" → 어업 외 부적합
- "IT기업", "SW기업", "ICT기업" → IT 외 부적합
- "관광업", "여행사", "숙박업" → 관광업 외 부적합
- "바이오", "제약", "의료기기" → 바이오/의료 외 부적합
- "뿌리산업" (주조, 금형, 용접, 표면처리, 열처리, 소성가공) → 해당 업종 외 부적합
- "콘텐츠", "게임", "영상" → 콘텐츠 외 부적합

→ 기업 업종(${ksicCategory}, KSIC: ${companyData.ksicCode})과 불일치하면 "부적합"

【4. 업력 조건】
- "창업 3년 이내", "3년 미만" → 업력 ${businessAge}년이 3년 초과면 부적합
- "창업 7년 이내", "7년 미만" → 업력 ${businessAge}년이 7년 초과면 부적합
- "업력 3년 이상", "설립 3년 이상" → 업력 ${businessAge}년이 3년 미만이면 부적합
- "예비창업자", "창업예정자" → 이미 설립된 기업은 부적합

【5. 기업 형태/인증 조건】
- "협동조합", "협동조합만" → 일반기업 부적합
- "사회적기업", "사회적경제기업" → 일반기업 부적합 (현재: ${companyData.certSocial === 'Y' ? '사회적기업' : '일반기업'})
- "벤처기업 필수", "벤처기업만" → 벤처인증 없으면 부적합 (현재: ${companyData.certVenture === 'Y' ? '있음' : '없음'})
- "여성기업", "여성CEO" → 여성기업 아니면 부적합 (현재: ${companyData.certWoman === 'Y' ? '있음' : '없음'})
- "장애인기업" → 장애인기업 아니면 부적합

【6. 특수 조건】
- "○○ 선정기업", "기존 참여기업" → 기존 선정 필요, 신규기업 부적합
- "수출기업", "수출실적 보유" → 내수기업 부적합 (현재: ${(companyData.exportRecent && companyData.exportRecent > 0) ? '수출기업' : '내수기업'})
- "청년창업", "청년CEO", "만 39세 이하" → 대표자 ${ceoAge}세가 40세 이상이면 부적합
- "시니어", "중장년", "만 50세 이상" → 대표자 ${ceoAge}세가 50세 미만이면 부적합
- "1인 기업", "1인 창조기업" → 직원 ${companyData.employeesTotal}명이 2명 이상이면 부적합
- "비영리", "비영리법인" → 영리기업 부적합
- "개인 소비자 대상", "B2C" → 기업 대상 사업이 아님, 부적합

【7. 분야 매칭】 (희망 분야: ${companyData.supportNeeds?.join(', ') || '전체'})
- 기업이 "전체"를 선택했으면 분야 무관
- 특정 분야 선택 시, 공고 분야와 최소한의 관련성 필요

═══════════════════════════════════════════════════════════════
📌 분석 대상 공고 목록 (${programs.length}개) - 반드시 ${programs.length}개 전부 분석!
═══════════════════════════════════════════════════════════════
${programs.map((p, i) => `
【공고 ${i + 1}】 ID: ${p.id}
• 공고명: ${p.name || ''}
• 주관기관: ${p.organization || ''}
• 지원분야: ${p.category || ''}
• 지원대상: ${p.target || ''}
• 사업개요: ${(p.description || '').substring(0, 200)}
• 신청기간: ${p.applicationPeriod || ''}
`).join('\n')}

═══════════════════════════════════════════════════════════════
📌 출력 형식 (반드시 준수) - ${programs.length}개 모두 출력!
═══════════════════════════════════════════════════════════════

[
  {
    "id": "공고 ID",
    "index": 0,
    "eligible": true,
    "reason": "적합 판정 이유 (50자 이내)",
    "summary": "지원사업 핵심 내용 (150자 이내)",
    "recommendation": "신청 권장 이유 (100자 이내)"
  }
]

⚠️ 필수: 
1. 반드시 ${programs.length}개 공고 전부 분석 결과 출력
2. 이미 필터링된 적합 공고이므로 대부분 eligible: true
3. 순수 JSON만 출력 (마크다운/설명 없이)
`;

      // Gemini API 호출
      const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
      
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192  // 🔥 20개면 충분
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Gemini API 오류:', response.status, errorText);
        return { success: false, error: `Gemini API 오류: ${response.status}` };
      }

      const apiData = await response.json();
      const aiText = apiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

      console.log('📝 AI 응답 길이:', aiText.length);

      // JSON 추출
      let jsonText = aiText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      
      let summaryResults;
      try {
        summaryResults = JSON.parse(jsonText);
      } catch (e) {
        console.error('JSON 파싱 오류:', e);
        console.error('원본 텍스트:', jsonText.substring(0, 500));
        return { success: false, error: 'AI 응답 파싱 실패', rawText: aiText };
      }

      // 🔥 v3.2: 누락된 공고 체크 및 기본 결과 생성
      const aiResults = Array.isArray(summaryResults) ? summaryResults : [];
      const respondedIds = new Set(aiResults.map(r => r.id));
      
      console.log(`📊 AI 응답: ${aiResults.length}/${programs.length}개`);
      
      // 누락된 공고에 대해 기본 결과 생성
      programs.forEach((p, idx) => {
        if (!respondedIds.has(p.id)) {
          console.log(`⚠️ 누락된 공고 기본 결과 생성: ${p.name?.substring(0, 30)}`);
          aiResults.push({
            id: p.id,
            index: idx,
            eligible: true,
            reason: '서버 필터링 통과 - 신청 가능',
            summary: `${p.name || '지원사업'}. ${(p.description || '').substring(0, 100)}`,
            recommendation: '공고문 상세 내용을 확인하여 신청하세요.'
          });
        }
      });

      // 🆕 v3.2: 모든 분석 결과에 필터링 정보 추가 + ID 명시적 추가
      const allResults = aiResults.map((r, idx) => {
        const matchedProgram = programs.find(p => p.id === r.id) || programs[idx];
        return {
          ...r,
          id: r.id || matchedProgram?.id,
          programId: r.id || matchedProgram?.id,
          fitScore: matchedProgram?.fitScore || r.fitScore || 70,
          warningRegion: matchedProgram?.warningRegion || false,
          warningIndustry: matchedProgram?.warningIndustry || false
        };
      });
      
      // 점수순 정렬
      allResults.sort((a, b) => (b.fitScore || 0) - (a.fitScore || 0));

      // 🆕 성공 시 사용 횟수 증가 (무제한 사용자가 아니거나, 개별 제한이 있는 경우)
      // ★ 무료사용자도 개별 제한이 있으면 사용 횟수 증가해야 함
      if (!unlimitedCheck.unlimited || unlimitedCheck.hasCustomLimit) {
        await incrementDailyUsage(userId, 'summary');
        console.log(`📊 요약분석 사용 횟수 증가: ${userId}`);
      }
      console.log(`✅ AI 분석 완료: ${allResults.length}개 (요청 ${programs.length}개, 사용자: ${userId}, ${unlimitedCheck.reason})`);

      return { 
        success: true, 
        results: allResults,
        totalAnalyzed: allResults.length,
        totalSearched: filterResult.totalCount,
        matchedCount: filterResult.matchedCount,
        analyzedCount: allResults.length,  // 🔥 실제 분석된 개수
        maxAnalysisCount: 20,  // 🔥 v3.2: 최대 20개
        excludedStats: filterResult.excludedStats,
        remaining: unlimitedCheck.unlimited ? 999 : (limitCheck.remaining - 1),
        unlimited: unlimitedCheck.unlimited
      };

    } catch (error) {
      console.error('서버 오류:', error);
      return { success: false, error: error.message };
    }
  });

// ============================================================
// 3. analyzeProgramPDF - PDF 상세 분석
// ============================================================
exports.analyzeProgramPDF = functions
  .region('asia-northeast3')
  .runWith({ timeoutSeconds: 180, memory: '1GB' })
  .https.onCall(async (data, context) => {
    console.log('🚀 analyzeProgramPDF 함수 시작');
    console.log('📦 받은 데이터:', JSON.stringify(data || {}).substring(0, 200));
    
    try {
      // 🆕 로그인 확인
      if (!context.auth) {
        console.log('❌ 로그인 안됨');
        return { success: false, error: '로그인이 필요합니다.' };
      }
      
      const userId = context.auth.uid;
      console.log('👤 사용자 UID:', userId);
      
      // 🆕 무제한 사용자 여부 확인 (관리자/무료사용자)
      const unlimitedCheck = await isUnlimitedUser(userId);
      console.log('🔍 무제한 체크 결과:', JSON.stringify(unlimitedCheck));
      
      // 🆕 skipLimitCheck 먼저 추출 (변수 사용 전에 선언 필요)
      const skipLimitCheck = data?.skipLimitCheck || false;
      console.log('📄 skipLimitCheck:', skipLimitCheck);
      
      // 🆕 일일 사용 제한 체크
      let limitCheck = { allowed: true, count: 0, remaining: 999 };
      
      // ★★★ 디버깅 로그 강화 ★★★
      console.log(`📋 [상세분석] 제한 체크 시작 - userId: ${userId}`);
      console.log(`📋 [상세분석] unlimitedCheck:`, JSON.stringify(unlimitedCheck));
      
      // ★ 무료사용자 개별 제한 (detailLimit이 설정된 경우)
      // 🔥 skipLimitCheck가 true면 제한 체크 스킵 (상세분석은 첫 번째 PDF에서만 체크)
      const hasDetailLimit = !skipLimitCheck && 
                             unlimitedCheck.unlimited && 
                             unlimitedCheck.hasCustomLimit && 
                             unlimitedCheck.detailLimit !== undefined && 
                             unlimitedCheck.detailLimit !== 999;
      
      console.log(`📋 [상세분석] hasDetailLimit: ${hasDetailLimit}, detailLimit: ${unlimitedCheck.detailLimit}, skipLimitCheck: ${skipLimitCheck}`);
      
      if (hasDetailLimit) {
        console.log(`⏳ [상세분석] 무료사용자 제한 체크 - 한도: ${unlimitedCheck.detailLimit}회`);
        limitCheck = await checkDailyLimit(userId, 'detail', unlimitedCheck.detailLimit);
        console.log(`📊 [상세분석] 제한 체크 결과:`, JSON.stringify(limitCheck));
        
        if (!limitCheck.allowed) {
          console.log(`❌ [상세분석] 한도 초과! ${limitCheck.count}/${unlimitedCheck.detailLimit}`);
          return { 
            success: false, 
            error: `일일 상세분석 한도(${unlimitedCheck.detailLimit}회)를 초과했습니다.\n오늘 사용: ${limitCheck.count}회\n내일 다시 이용해주세요.`,
            limitExceeded: true,
            dailyLimit: unlimitedCheck.detailLimit,
            dailyUsed: limitCheck.count
          };
        }
        console.log(`🔓 [상세분석] 무료사용자 통과: ${unlimitedCheck.reason}, 사용: ${limitCheck.count}/${unlimitedCheck.detailLimit}회`);
      } else if (!unlimitedCheck.unlimited && !skipLimitCheck) {
        // 일반 사용자는 10회 제한 (skipLimitCheck가 아닐 때만)
        console.log(`⏳ [상세분석] 일반 사용자 제한 체크 - 한도: 10회`);
        limitCheck = await checkDailyLimit(userId, 'detail', 10);
        console.log(`📊 [상세분석] 제한 체크 결과:`, JSON.stringify(limitCheck));
        
        if (!limitCheck.allowed) {
          console.log(`❌ [상세분석] 한도 초과! ${limitCheck.count}/10`);
          return { 
            success: false, 
            error: `일일 상세분석 한도(10회)를 초과했습니다.\n오늘 사용: ${limitCheck.count}회\n내일 다시 이용해주세요.`,
            limitExceeded: true,
            dailyLimit: 10,
            dailyUsed: limitCheck.count
          };
        }
      } else if (skipLimitCheck) {
        console.log(`🔓 [상세분석] 제한 체크 스킵 (skipLimitCheck=true)`);
      } else {
        console.log(`🔓 [상세분석] 무제한 사용자(제한없음): ${unlimitedCheck.reason}`);
      }
      
      const { pdfUrl, companyData } = data || {};
      console.log('📄 pdfUrl:', pdfUrl ? pdfUrl.substring(0, 100) : 'undefined');
      const GEMINI_API_KEY = getGeminiApiKey();
      
      if (!GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다.');
      }

      if (!pdfUrl) {
        console.log('⚠️ pdfUrl이 없음 - 스킵');
        return { success: false, error: 'PDF URL이 제공되지 않았습니다.', skipped: true };
      }
      
      console.log(`📄 PDF 분석 시작: ${pdfUrl} - 사용자: ${userId} (${unlimitedCheck.reason})`);
      
      // 1. PDF 다운로드 (타임아웃 15초로 증가)
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      
      let pdfResponse;
      try {
        pdfResponse = await fetch(pdfUrl, { signal: controller.signal });
        clearTimeout(timeout);
      } catch (e) {
        clearTimeout(timeout);
        throw new Error('PDF 다운로드 시간 초과 (15초)');
      }
      
      if (!pdfResponse.ok) {
        throw new Error(`PDF 다운로드 실패: ${pdfResponse.status}`);
      }
      
      // 🔥 Content-Type 헤더에서 실제 파일 타입 확인
      const contentType = pdfResponse.headers.get('content-type') || '';
      let detectedMimeType = 'application/pdf'; // 기본값
      
      if (contentType.includes('pdf')) {
        detectedMimeType = 'application/pdf';
      } else if (contentType.includes('hwp') || contentType.includes('x-hwp')) {
        detectedMimeType = 'application/x-hwp';
      } else if (contentType.includes('msword') || contentType.includes('doc')) {
        detectedMimeType = 'application/msword';
      } else if (contentType.includes('officedocument')) {
        detectedMimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      }
      // octet-stream이면 기본값 PDF 유지
      
      console.log(`📄 Content-Type: ${contentType} → MIME: ${detectedMimeType}`);
      
      const pdfBuffer = await pdfResponse.arrayBuffer();
      const pdfSizeKB = Math.round(pdfBuffer.byteLength / 1024);
      console.log('📦 PDF 크기:', pdfSizeKB, 'KB');
      
      // PDF가 너무 크면 스킵 (10MB로 증가)
      if (pdfBuffer.byteLength > 10 * 1024 * 1024) {
        throw new Error('PDF 파일이 너무 큽니다 (10MB 초과)');
      }
      
      const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');
      
      // PDF에서 텍스트 추출 시도
      let pdfText = '';
      try {
        // pdf-parse 모듈 동적 로드
        const pdfParseModule = require('pdf-parse');
        const pdfParseFunc = typeof pdfParseModule === 'function' ? pdfParseModule : pdfParseModule.default;
        
        if (typeof pdfParseFunc === 'function') {
          const pdfData = await pdfParseFunc(Buffer.from(pdfBuffer));
          pdfText = pdfData.text || '';
          console.log('📄 PDF 텍스트 추출 완료:', pdfText.length, '자');
        } else {
          throw new Error('pdf-parse 모듈 로드 실패');
        }
      } catch (pdfError) {
        console.log('⚠️ PDF 텍스트 추출 실패 (직접 전송 모드 사용):', pdfError.message);
        // 텍스트 추출 실패해도 계속 진행 - 직접 전송 모드 사용
        pdfText = '';
      }
      
      // 텍스트가 너무 길면 앞부분만 사용 (약 50,000자 = 약 25,000 토큰)
      if (pdfText.length > 50000) {
        pdfText = pdfText.substring(0, 50000) + '\n\n... (이하 생략)';
      }
      
      // 업종 대분류 추출
      const ksicPrefix = (companyData?.ksicCode || '').substring(0, 2);
      const ksicCategoryMap = {
        '01': '농업', '02': '임업', '03': '어업',
        '10': '식품제조', '11': '음료제조', '13': '섬유', '14': '의류',
        '20': '화학', '21': '의약품', '22': '고무플라스틱', '23': '비금속광물',
        '24': '금속', '25': '금속가공', '26': '전자부품', '27': '의료기기',
        '28': '전기장비', '29': '기계장비', '30': '자동차', '31': '운송장비',
        '41': '건설', '42': '토목', '45': '자동차판매', '46': '도매', '47': '소매',
        '49': '육상운송', '52': '물류창고', '55': '숙박', '56': '음식점',
        '58': '출판', '59': '영상제작', '60': '방송', '61': '통신', 
        '62': '소프트웨어', '63': '정보서비스', '64': '금융',
        '70': '본사', '71': '연구개발', '72': '과학기술서비스', '73': '전문서비스',
        '74': '디자인', '79': '여행', '85': '교육', '86': '보건'
      };
      const ksicCategory = ksicCategoryMap[ksicPrefix] || '기타';
      
      // 대표자 나이 계산
      let ceoAge = 0;
      if (companyData?.ceoBirth) {
        const birthYear = parseInt(companyData.ceoBirth.substring(0, 4));
        ceoAge = new Date().getFullYear() - birthYear;
      }
      
      // 2. Gemini API - 프리미엄 상세분석 프롬프트 (Pro 모델용)
      const prompt = `당신은 20년 경력의 대한민국 정부지원사업 전문 컨설턴트입니다.
수천 건의 사업 선정을 도왔고, 직접 평가위원으로 참여한 경험도 있습니다.
지금 아래 기업의 CEO가 유료 상담(2,000원)을 요청했습니다.

【당신의 임무】
이 PDF 공고문을 철저히 분석하여, CEO가 "신청할지 말지, 어떻게 준비할지"를 
즉시 결정할 수 있는 프리미엄 분석 보고서를 작성하세요.

무료 요약분석과는 차원이 다른, 실제 컨설팅 수준의 인사이트를 제공해야 합니다.

═══════════════════════════════════════════════════════════════
🏢 분석 대상 기업 프로필
═══════════════════════════════════════════════════════════════

【기본정보】
• 기업명: ${companyData?.companyName || '미입력'}
• 법인형태: ${companyData?.companyType || '미입력'}
• 소재지: ${companyData?.locationSido || '미입력'} ${companyData?.locationSigungu || ''}
• 수도권여부: ${companyData?.capitalArea === 'Y' ? '수도권' : '비수도권'}
• 기업규모: ${companyData?.companySize || '미입력'}
• 업종: ${ksicCategory} (KSIC: ${companyData?.ksicCode || '미입력'})
• 세부업종: ${companyData?.ksicName || '미입력'}
• 주력제품: ${companyData?.productKeywords || '미입력'}

【업력】
• 설립일: ${companyData?.establishDate || '미입력'}
• 업력: ${companyData?.businessAge || 0}년 (${companyData?.businessAge <= 3 ? '초기창업기' : companyData?.businessAge <= 7 ? '성장기' : '성숙기'})

【재무현황】
• 최근매출: ${companyData?.revenueRecent ? Math.round(companyData.revenueRecent / 100000000) + '억원' : '미입력'}
• 전년매출: ${companyData?.revenuePrevious ? Math.round(companyData.revenuePrevious / 100000000) + '억원' : '미입력'}
• 영업이익: ${companyData?.profitRecent ? Math.round(companyData.profitRecent / 100000000) + '억원' : '미입력'}

【고용현황】
• 상시근로자: ${companyData?.employeesTotal || 0}명
• 청년(15~34세): ${companyData?.employeesYouth || 0}명
• 여성: ${companyData?.employeesFemale || 0}명

【대표자】
• 성별: ${companyData?.ceoGender === 'M' ? '남성' : companyData?.ceoGender === 'F' ? '여성' : '미입력'}
• 연령: ${ceoAge > 0 ? ceoAge + '세' : '미입력'} ${ceoAge > 0 && ceoAge <= 39 ? '(청년CEO)' : ceoAge >= 60 ? '(시니어CEO)' : ''}

【보유인증】
• 벤처기업: ${companyData?.certVenture === 'Y' ? '✅' : '❌'}
• 이노비즈: ${companyData?.certInnobiz === 'Y' ? '✅' : '❌'}
• 메인비즈: ${companyData?.certMainbiz === 'Y' ? '✅' : '❌'}
• 여성기업: ${companyData?.certWoman === 'Y' ? '✅' : '❌'}
• 사회적기업: ${companyData?.certSocial === 'Y' ? '✅' : '❌'}

【기술역량】
• 연구조직: ${companyData?.researchOrg || '없음'}
• 특허: 등록 ${companyData?.patentsRegistered || 0}건 / 출원 ${companyData?.patentsPending || 0}건

【수출】
• 수출실적: ${(companyData?.exportRecent && companyData.exportRecent > 0) ? '있음 ($' + companyData.exportRecent.toLocaleString() + ')' : '없음 (내수기업)'}

【결격사유】
• 세금체납: ${companyData?.taxArrears === 'N' && companyData?.localTaxArrears === 'N' ? '✅ 없음' : '⚠️ 확인필요'}

═══════════════════════════════════════════════════════════════
📋 PDF 분석 가이드 (6단계)
═══════════════════════════════════════════════════════════════

【1단계】 사업 개요 파악
→ 사업목적, 주관부처, 총예산, 핵심 키워드

【2단계】 자격요건 완전 추출
→ 필수조건 vs 우대조건 구분
→ 지역/규모/업종/업력/매출/인증별 조건
→ 제외대상 (명시적 불가 조건)

【3단계】 지원내용 분석
→ 기업당 지원한도, 정부vs기업 부담비율, 지원항목

【4단계】 평가체계 분석
→ 평가항목별 배점, 가점항목, 평가방식(서류/발표/현장)

【5단계】 기업 맞춤 분석 ⭐ 가장 중요
→ 위 기업 프로필과 공고 요건 1:1 대조
→ 충족/미충족 항목 명확히 구분
→ 획득 가능한 가점 계산

【6단계】 실전 신청전략
→ 평가위원 관점에서 어필 포인트
→ 흔한 탈락 사유와 회피법
→ 사업계획서 핵심 메시지

═══════════════════════════════════════════════════════════════
📤 출력 형식 (JSON)
═══════════════════════════════════════════════════════════════

{
  "programSummary": "사업목적, 지원대상, 지원내용, 지원규모 종합요약 (400자)",
  
  "eligibility": {
    "companySize": "기업규모 조건",
    "businessAge": "업력 조건",
    "requiredCerts": ["필수 인증 목록"],
    "regionLimit": "지역제한 (전국 또는 특정지역)",
    "industryLimit": "업종제한",
    "revenueLimit": "매출 조건",
    "exclusions": ["제외대상/신청불가 조건"],
    "otherRequirements": ["기타 자격요건"]
  },
  
  "budget": {
    "totalBudget": "총 예산규모",
    "perCompany": "기업당 최대 지원금액",
    "govRatio": "정부지원 비율",
    "companyRatio": "기업부담 비율/방식",
    "selectedCount": "선정 예정 기업수",
    "supportItems": ["지원 가능 비용항목"]
  },
  
  "schedule": {
    "applicationPeriod": "신청기간 (시작~마감)",
    "applicationMethod": "신청방법 (시스템명, URL)",
    "reviewPeriod": "심사기간",
    "selectionDate": "선정발표일",
    "executionPeriod": "사업수행기간"
  },
  
  "documents": {
    "required": ["필수 제출서류 전체"],
    "optional": ["선택/가점 서류"],
    "preparationTips": ["서류 준비 실무팁"]
  },
  
  "evaluation": {
    "stages": ["평가단계 (예: 서류→발표)"],
    "criteria": ["평가항목과 배점"],
    "bonusPoints": ["가점항목과 점수"],
    "disqualification": ["결격/탈락 사유"]
  },
  
  "companyFit": {
    "fitScore": 0-100,
    "fitSummary": "자격요건 충족 여부 한눈에 (예: 기업규모 ✅, 업력 ✅, 지역 ✅)",
    "expectedBonus": "획득 가능 가점 (예: 총 +5점 = 벤처 +3, 고용 +2)",
    "competitionLevel": "예상 경쟁 난이도 (높음/보통/낮음)",
    "strengths": [
      "강점 1: 구체적 내용 + 평가 유리한 이유 (100자)",
      "강점 2: ...",
      "강점 3: ..."
    ],
    "weaknesses": [
      "보완점 1: 구체적 내용 + 대응방안 (100자)",
      "보완점 2: ..."
    ]
  },
  
  "applicationStrategy": {
    "coreMessage": "사업계획서 핵심 메시지 (한 문장)",
    "keyAppealPoints": [
      "어필포인트 1: 무엇을 + 어떻게 강조 (100자)",
      "어필포인트 2: ...",
      "어필포인트 3: ..."
    ],
    "commonMistakes": [
      "흔한 실수 1: 무엇이 문제 + 어떻게 피할지",
      "흔한 실수 2: ..."
    ],
    "preparationChecklist": [
      "D-14: 준비할 것",
      "D-7: 준비할 것",
      "D-3: 최종 점검"
    ]
  },
  
  "recommendation": "【최종 추천의견】 ① 결론(신청 적극권장/권장/신중검토/재검토필요) ② 핵심근거 3가지 ③ 선정가능성(높음/보통/낮음)과 이유 ④ 반드시 해야 할 것 3가지 ⑤ 절대 하지 말 것 ⑥ 한줄 요약 (최대 1000자)"
}

═══════════════════════════════════════════════════════════════
✅ Good 예시 vs ❌ Bad 예시
═══════════════════════════════════════════════════════════════

【fitSummary】
❌ Bad: "대부분의 요건을 충족합니다"
✅ Good: "기업규모 ✅ 중소기업, 업력 ✅ 5년(3년↑ 충족), 지역 ✅ 경기도, 업종 ⚠️ 확인필요"

【strengths】
❌ Bad: "벤처기업 인증을 보유하고 있어 유리합니다"
✅ Good: "벤처기업 인증 보유 → 기술성 평가 가점 3점 확보, 전체 지원자 중 40%만 보유하므로 경쟁우위"

【weaknesses】
❌ Bad: "매출이 부족합니다"
✅ Good: "최근 매출 5억원으로 평균(10억) 대비 낮음 → 대응: 매출성장률(+30%) 강조, 수주계약서로 미래매출 증빙"

【keyAppealPoints】
❌ Bad: "기술력을 강조하세요"
✅ Good: "특허 3건 보유 → 사업계획서 기술현황 섹션에 특허증 첨부 + 각 특허의 사업화 계획을 매출목표와 연결"

【recommendation】
❌ Bad: "이 사업에 신청하시는 것을 권장합니다"
✅ Good: "【신청 적극 권장】 ① 핵심요건 100% 충족 + 가점 5점 확보 ② 근거: 벤처(+3), 고용증가(+2), 제조업 일치 ③ 선정가능성: 높음 (경쟁률 4:1, 가점으로 상위 30% 진입) ④ 필수: 재무제표 공인회계사 확인, 기술로드맵 구체화, 고용계획 수치화 ⑤ 금지: 분량초과, 예산 과다계상, 수행실적 누락 ⑥ 한줄: 벤처+제조업+고용증가 3박자, D-7 전 서류완비 후 신청"

═══════════════════════════════════════════════════════════════
⚠️ 필수 준수사항
═══════════════════════════════════════════════════════════════

1. PDF에 없는 정보 → "공고문에서 확인되지 않음"
2. 반드시 순수 JSON만 출력 (마크다운, 설명문 금지)
3. strengths 최소 3개, weaknesses 최소 2개, keyAppealPoints 최소 3개
4. 모든 분석은 위 기업 프로필 기준으로 맞춤 작성
5. 추상적 표현 금지, 구체적 수치와 행동 제시
6. recommendation은 CEO가 바로 결정할 수 있는 수준으로

【점수 기준】
• 90점↑: 핵심요건 완벽충족 + 다수 가점 → "선정가능성 매우 높음"
• 80~89: 핵심요건 충족 + 일부 가점 → "선정가능성 높음"  
• 70~79: 핵심요건 충족 + 가점 없음 → "신청권장, 경쟁력 보완필요"
• 60~69: 일부 요건 확인필요 → "조건 확인 후 검토"
• 60점↓: 핵심요건 미충족 → "요건 재검토 필요"

═══════════════════════════════════════════════════════════════
📄 분석할 공고문 내용
═══════════════════════════════════════════════════════════════

${pdfText}`;

      // PDF 텍스트 추출 실패 또는 내용이 너무 짧으면 PDF를 직접 전송
      const usePdfDirect = pdfText.length < 500 || pdfText.includes('PDF 텍스트 추출에 실패');
      
      // PDF 직접 전송 모드일 경우 프롬프트 수정
      const finalPrompt = usePdfDirect 
        ? prompt.replace(pdfText, '(PDF 파일이 직접 첨부되어 있습니다. 첨부된 PDF 내용을 분석해주세요.)')
        : prompt;
      
      let requestBody;
      if (usePdfDirect) {
        console.log(`📄 PDF 직접 전송 모드 (MIME: ${detectedMimeType})`);
        requestBody = {
          contents: [{
            parts: [
              { text: finalPrompt },
              {
                inline_data: {
                  mime_type: detectedMimeType,  // 🔥 감지된 MIME 타입 사용
                  data: pdfBase64
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 16384
          }
        };
      } else {
        requestBody = {
          contents: [{
            parts: [
              { text: finalPrompt }
            ]
          }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 16384
          }
        };
      }
      
      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        }
      );
      
      if (!geminiResponse.ok) {
        const errorText = await geminiResponse.text();
        console.error('Gemini API 오류:', geminiResponse.status, errorText);
        throw new Error(`Gemini API 오류: ${geminiResponse.status}`);
      }
      
      const geminiData = await geminiResponse.json();
      
      if (!geminiData.candidates?.[0]?.content?.parts?.[0]?.text) {
        throw new Error('Gemini 응답 없음');
      }
      
      const analysisText = geminiData.candidates[0].content.parts[0].text;
      console.log('📝 AI 응답 길이:', analysisText.length);
      
      // JSON 추출
      let jsonText = analysisText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      
      let analysis;
      try {
        analysis = JSON.parse(jsonText);
      } catch (e) {
        console.error('JSON 파싱 오류:', e);
        console.error('원본 텍스트:', jsonText.substring(0, 500));
        // JSON 파싱 실패 시 기본 구조 반환
        analysis = {
          programSummary: analysisText.substring(0, 200),
          eligibility: { companySize: "확인 필요", businessAge: "확인 필요" },
          budget: { totalBudget: "확인 필요", perCompany: "확인 필요" },
          schedule: { applicationPeriod: "확인 필요" },
          companyFit: { eligible: null, fitScore: 0, recommendation: "PDF 분석에 실패했습니다. 공고문을 직접 확인해주세요." }
        };
      }
      
      // 🆕 성공 시 사용 횟수 증가 (무제한 사용자가 아니거나, 개별 제한이 있는 경우)
      // ★ 무료사용자도 개별 제한이 있으면 사용 횟수 증가해야 함
      // 🔥 skipLimitCheck가 true면 사용 횟수 증가도 스킵 (첫 번째 PDF에서만 증가)
      if (!skipLimitCheck && (!unlimitedCheck.unlimited || unlimitedCheck.hasCustomLimit)) {
        await incrementDailyUsage(userId, 'detail');
        console.log(`📊 상세분석 사용 횟수 증가: ${userId}`);
      } else if (skipLimitCheck) {
        console.log(`📊 상세분석 사용 횟수 증가 스킵 (skipLimitCheck=true)`);
      }
      console.log(`✅ PDF 분석 완료 (사용자: ${userId}, ${unlimitedCheck.reason})`);
      
      return { 
        success: true, 
        analysis, 
        remaining: unlimitedCheck.unlimited ? 999 : (limitCheck.remaining - 1),
        unlimited: unlimitedCheck.unlimited
      };
      
    } catch (error) {
      console.error('❌ PDF 분석 실패:', error.message);
      return { success: false, error: error.message };
    }
  });

// ============================================================
// 4. analyzeCompanyMatch - AI 기업 매칭 분석
// ============================================================
exports.analyzeCompanyMatch = functions
  .region('asia-northeast3')
  .runWith({ timeoutSeconds: 300, memory: '512MB' })
  .https.onCall(async (data, context) => {
    try {
      const { companyData, programs } = data || {};
      const GEMINI_API_KEY = getGeminiApiKey();

      if (!GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다.');
      }

      console.log(`🤖 AI 매칭 분석 시작: ${programs?.length || 0}개 프로그램`);

      // 업종 대분류 추출
      const ksicPrefix = (companyData?.ksicCode || '').substring(0, 2);
      const ksicCategoryMap = {
        '01': '농업', '02': '임업', '03': '어업',
        '10': '식품제조', '11': '음료제조', '13': '섬유', '14': '의류',
        '20': '화학', '21': '의약품', '22': '고무플라스틱', '23': '비금속광물',
        '24': '금속', '25': '금속가공', '26': '전자부품', '27': '의료기기',
        '28': '전기장비', '29': '기계장비', '30': '자동차', '31': '운송장비',
        '41': '건설', '42': '토목', '45': '자동차판매', '46': '도매', '47': '소매',
        '49': '육상운송', '52': '물류창고', '55': '숙박', '56': '음식점',
        '58': '출판', '59': '영상제작', '60': '방송', '61': '통신',
        '62': '소프트웨어', '63': '정보서비스', '64': '금융',
        '70': '본사', '71': '연구개발', '72': '과학기술서비스', '73': '전문서비스',
        '74': '디자인', '79': '여행', '85': '교육', '86': '보건'
      };
      const ksicCategory = ksicCategoryMap[ksicPrefix] || '기타';

      // 규칙 기반 매칭 점수 계산
      const enrichedPrograms = programs.map(program => {
        let matchScore = 50; // 기본 점수
        const matchReasons = [];
        const unmatchReasons = [];

        // 1. 지역 매칭
        const programText = `${program.name} ${program.target} ${program.description} ${program.hashTags}`.toLowerCase();
        const userRegion = companyData?.locationSido || '';
        
        if (programText.includes('전국') || !programText.match(/서울|경기|인천|부산|대구|광주|대전|울산|세종|강원|충북|충남|전북|전남|경북|경남|제주/)) {
          matchScore += 10;
          matchReasons.push('전국 대상 사업');
        } else if (userRegion && programText.includes(userRegion.toLowerCase().replace('특별시', '').replace('광역시', '').replace('도', ''))) {
          matchScore += 15;
          matchReasons.push(`${userRegion} 지역 대상`);
        } else {
          matchScore -= 20;
          unmatchReasons.push('지역 제한 있음');
        }

        // 2. 기업 규모 매칭
        const companySize = companyData?.companySize || '';
        if (programText.includes('중소기업') && (companySize.includes('소기업') || companySize.includes('중기업'))) {
          matchScore += 10;
          matchReasons.push('중소기업 대상');
        }
        if (programText.includes('소기업') && companySize.includes('소기업')) {
          matchScore += 5;
          matchReasons.push('소기업 우대');
        }

        // 3. 업종 매칭
        if (ksicCategory !== '기타') {
          if (programText.includes(ksicCategory.toLowerCase()) || 
              programText.includes('제조') && ksicCategory.includes('제조')) {
            matchScore += 10;
            matchReasons.push(`${ksicCategory} 업종 관련`);
          }
        }

        // 4. 인증 가점
        if (companyData?.certVenture === 'Y' && programText.includes('벤처')) {
          matchScore += 5;
          matchReasons.push('벤처기업 우대');
        }
        if (companyData?.certInnobiz === 'Y' && programText.includes('이노비즈')) {
          matchScore += 5;
          matchReasons.push('이노비즈 우대');
        }

        // 5. 분야 매칭
        const category = program.category || '';
        if (category) {
          const supportNeeds = companyData?.supportNeeds || [];
          if (supportNeeds.length === 0 || supportNeeds.includes('전체')) {
            matchScore += 5;
          } else if (supportNeeds.some(need => category.includes(need))) {
            matchScore += 10;
            matchReasons.push(`희망 분야(${category}) 일치`);
          }
        }

        // 점수 범위 제한
        matchScore = Math.max(0, Math.min(100, matchScore));

        return {
          ...program,
          matchScore,
          matchReasons,
          unmatchReasons
        };
      });

      // 점수순 정렬
      enrichedPrograms.sort((a, b) => b.matchScore - a.matchScore);

      console.log(`✅ 매칭 완료: ${enrichedPrograms.length}개 프로그램`);

      return {
        success: true,
        matchedPrograms: enrichedPrograms
      };

    } catch (error) {
      console.error('❌ 매칭 분석 오류:', error);
      return {
        success: false,
        error: error.message,
        matchedPrograms: []
      };
    }
  });

// ============================================================
// 5. 크레딧 시스템 - Firestore 기반
// ============================================================

const db = admin.firestore();

/**
 * 크레딧 조회
 * ★ 일반회원 무료: 요약 20회/월, 상세 10회/월
 * ★ 무료사용자: 개별 제한(summaryLimit, detailLimit) 적용
 */
// 🔧 일반회원 월간 무료 제공 횟수 설정 (하드코딩)
const FREE_SUMMARY_PER_MONTH = 20;  // 요약분석 월 무료 횟수
const FREE_DETAIL_PER_MONTH = 10;   // 상세분석 월 무료 횟수
const DAILY_LIMIT_DEFAULT = 10;      // 일반회원 1일 제한 (기존 유지)

exports.getCredits = functions
  .region('asia-northeast3')
  .https.onCall(async (data, context) => {
    try {
      // 인증 확인
      if (!context.auth) {
        return { success: false, error: '로그인이 필요합니다.' };
      }
      
      const userId = context.auth.uid;
      const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
      
      // 🆕 무제한 사용자 여부 확인 (+ 개별 제한 정보)
      const unlimitedCheck = await isUnlimitedUser(userId);
      
      // 🆕 일일 사용량 조회
      const today = getKoreanToday();
      const usageDoc = await db.collection('userUsage').doc(userId).get();
      let dailyUsage = { summaryCount: 0, detailCount: 0 };
      if (usageDoc.exists && usageDoc.data().date === today) {
        dailyUsage = {
          summaryCount: usageDoc.data().summaryCount || 0,
          detailCount: usageDoc.data().detailCount || 0
        };
      }
      
      // Firestore에서 사용자 크레딧 조회
      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();
      
      // 🆕 기존 userCredits 컬렉션도 확인 (마이그레이션 지원)
      const oldUserRef = db.collection('userCredits').doc(userId);
      const oldUserDoc = await oldUserRef.get();
      
      let credits;
      
      if (!userDoc.exists) {
        // users 컬렉션에 없음
        if (oldUserDoc.exists && oldUserDoc.data().paidBalance > 0) {
          // userCredits에 데이터 있음 - users로 마이그레이션
          const oldData = oldUserDoc.data();
          credits = {
            freeSummaryRemaining: FREE_SUMMARY_PER_MONTH,  // ★ 요약 20회
            freeDetailRemaining: FREE_DETAIL_PER_MONTH,    // ★ 상세 10회
            freeRemaining: oldData.freeRemaining || FREE_SUMMARY_PER_MONTH,  // 호환성
            paidBalance: oldData.paidBalance || 0,
            lastResetMonth: currentMonth,
            createdAt: oldData.createdAt || new Date().toISOString(),
            migratedFrom: 'userCredits',
            migratedAt: new Date().toISOString()
          };
          await userRef.set(credits);
          console.log('🔄 userCredits → users 마이그레이션 완료:', userId, credits.paidBalance);
        } else {
          // 신규 사용자 - 기본 크레딧 생성
          credits = {
            freeSummaryRemaining: FREE_SUMMARY_PER_MONTH,  // ★ 요약 20회
            freeDetailRemaining: FREE_DETAIL_PER_MONTH,    // ★ 상세 10회
            freeRemaining: FREE_SUMMARY_PER_MONTH,  // 호환성
            paidBalance: 0,
            lastResetMonth: currentMonth,
            createdAt: new Date().toISOString()
          };
          await userRef.set(credits);
          console.log('🆕 신규 사용자 크레딧 생성:', userId);
        }
      } else {
        credits = userDoc.data();
        
        // 🆕 users에 paidBalance가 0인데 userCredits에 잔액이 있으면 병합
        if ((credits.paidBalance || 0) === 0 && oldUserDoc.exists && (oldUserDoc.data().paidBalance || 0) > 0) {
          const oldBalance = oldUserDoc.data().paidBalance;
          credits.paidBalance = oldBalance;
          await userRef.update({ 
            paidBalance: oldBalance,
            migratedFrom: 'userCredits',
            migratedAt: new Date().toISOString()
          });
          console.log('🔄 userCredits 잔액 병합:', userId, oldBalance);
        }
        
        // 월이 바뀌었으면 무료 횟수 리셋
        if (credits.lastResetMonth !== currentMonth) {
          credits.freeSummaryRemaining = FREE_SUMMARY_PER_MONTH;  // ★ 요약 20회
          credits.freeDetailRemaining = FREE_DETAIL_PER_MONTH;    // ★ 상세 10회
          credits.freeRemaining = FREE_SUMMARY_PER_MONTH;  // 호환성
          credits.lastResetMonth = currentMonth;
          await userRef.update({
            freeSummaryRemaining: FREE_SUMMARY_PER_MONTH,
            freeDetailRemaining: FREE_DETAIL_PER_MONTH,
            freeRemaining: FREE_SUMMARY_PER_MONTH,
            lastResetMonth: currentMonth
          });
          console.log('📅 월간 무료 횟수 리셋:', userId);
        }
        
        // ★ 기존 사용자에게 새 필드가 없으면 추가
        if (credits.freeSummaryRemaining === undefined || credits.freeDetailRemaining === undefined) {
          // 기존 freeRemaining 값을 기준으로 계산
          const usedSummary = FREE_SUMMARY_PER_MONTH - (credits.freeRemaining || FREE_SUMMARY_PER_MONTH);
          credits.freeSummaryRemaining = Math.max(0, FREE_SUMMARY_PER_MONTH - usedSummary);
          credits.freeDetailRemaining = FREE_DETAIL_PER_MONTH;  // 상세는 새로 추가되므로 전체 부여
          await userRef.update({
            freeSummaryRemaining: credits.freeSummaryRemaining,
            freeDetailRemaining: credits.freeDetailRemaining
          });
          console.log('🔧 기존 사용자 새 필드 추가:', userId, credits.freeSummaryRemaining, credits.freeDetailRemaining);
        }
        
        // ★ paidBalance가 undefined면 0으로 초기화
        if (credits.paidBalance === undefined) {
          credits.paidBalance = 0;
        }
        // ★ freeRemaining이 undefined면 기본값 설정
        if (credits.freeRemaining === undefined) {
          credits.freeRemaining = credits.freeSummaryRemaining || FREE_SUMMARY_PER_MONTH;
        }
      }
      
      return {
        success: true,
        credits: {
          freeSummaryRemaining: credits.freeSummaryRemaining || 0,  // ★ 요약 무료 잔여
          freeDetailRemaining: credits.freeDetailRemaining || 0,    // ★ 상세 무료 잔여
          freeRemaining: credits.freeRemaining || credits.freeSummaryRemaining || 0,  // 호환성
          paidBalance: credits.paidBalance || 0,  // ★ undefined 방지
          lastResetMonth: credits.lastResetMonth
        },
        // ★ 월간 무료 제공 횟수 (클라이언트에서 표시용)
        freeSummaryPerMonth: FREE_SUMMARY_PER_MONTH,
        freeDetailPerMonth: FREE_DETAIL_PER_MONTH,
        // 🆕 무제한 사용자 정보 추가
        unlimited: unlimitedCheck.unlimited,
        unlimitedReason: unlimitedCheck.reason,
        // ★ 무료사용자 개별 제한 (있는 경우)
        summaryLimit: unlimitedCheck.summaryLimit || null,
        detailLimit: unlimitedCheck.detailLimit || null,
        hasCustomLimit: unlimitedCheck.hasCustomLimit || false,
        // 🆕 일일 사용량 정보 추가
        dailyUsage: dailyUsage,
        dailyLimit: DAILY_LIMIT_DEFAULT
      };
      
    } catch (error) {
      console.error('❌ 크레딧 조회 오류:', error);
      return { success: false, error: error.message };
    }
  });

/**
 * 크레딧 차감
 * ★ 요약분석: 무료 20회/월, 이후 500P
 * ★ 상세분석: 무료 10회/월, 이후 2000P
 */
exports.deductCredits = functions
  .region('asia-northeast3')
  .https.onCall(async (data, context) => {
    try {
      // 인증 확인
      if (!context.auth) {
        return { success: false, error: '로그인이 필요합니다.' };
      }
      
      const userId = context.auth.uid;
      const { type } = data; // 'summary' | 'detail'
      const currentMonth = new Date().toISOString().slice(0, 7);
      
      // Firestore에서 사용자 크레딧 조회
      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();
      
      if (!userDoc.exists) {
        return { success: false, error: '사용자 정보가 없습니다.' };
      }
      
      let credits = userDoc.data();
      
      // 월이 바뀌었으면 무료 횟수 리셋
      if (credits.lastResetMonth !== currentMonth) {
        credits.freeSummaryRemaining = FREE_SUMMARY_PER_MONTH;  // ★ 요약 20회
        credits.freeDetailRemaining = FREE_DETAIL_PER_MONTH;    // ★ 상세 10회
        credits.freeRemaining = FREE_SUMMARY_PER_MONTH;  // 호환성
        credits.lastResetMonth = currentMonth;
      }
      
      // ★ 기존 사용자에게 새 필드가 없으면 기본값 설정
      if (credits.freeSummaryRemaining === undefined) {
        credits.freeSummaryRemaining = credits.freeRemaining || FREE_SUMMARY_PER_MONTH;
      }
      if (credits.freeDetailRemaining === undefined) {
        credits.freeDetailRemaining = FREE_DETAIL_PER_MONTH;
      }
      // ★ paidBalance가 undefined면 0으로 초기화 (무료사용자 등)
      if (credits.paidBalance === undefined) {
        credits.paidBalance = 0;
      }
      // ★ freeRemaining이 undefined면 기본값 설정
      if (credits.freeRemaining === undefined) {
        credits.freeRemaining = credits.freeSummaryRemaining || FREE_SUMMARY_PER_MONTH;
      }
      
      // 차감 처리
      let cost = 0;
      let usedFreeType = null;
      
      if (type === 'summary') {
        if (credits.freeSummaryRemaining > 0) {
          // 무료 사용
          credits.freeSummaryRemaining--;
          credits.freeRemaining = credits.freeSummaryRemaining;  // 호환성
          cost = 0;
          usedFreeType = 'summary';
          console.log(`📊 무료 요약분석 사용: ${userId}, 잔여 ${credits.freeSummaryRemaining}/${FREE_SUMMARY_PER_MONTH}회`);
        } else if (credits.paidBalance >= 500) {
          // 유료 사용
          credits.paidBalance -= 500;
          cost = 500;
          console.log(`📊 유료 요약분석 사용: ${userId}, 잔액 ${credits.paidBalance}P`);
        } else {
          return { success: false, error: '포인트가 부족합니다.' };
        }
      } else if (type === 'detail') {
        // ★ 상세분석도 무료 횟수 체크
        if (credits.freeDetailRemaining > 0) {
          // 무료 사용
          credits.freeDetailRemaining--;
          cost = 0;
          usedFreeType = 'detail';
          console.log(`📄 무료 상세분석 사용: ${userId}, 잔여 ${credits.freeDetailRemaining}/${FREE_DETAIL_PER_MONTH}회`);
        } else if (credits.paidBalance >= 2000) {
          // 유료 사용
          credits.paidBalance -= 2000;
          cost = 2000;
          console.log(`📄 유료 상세분석 사용: ${userId}, 잔액 ${credits.paidBalance}P`);
        } else {
          return { success: false, error: '포인트가 부족합니다. (2,000P 필요)' };
        }
      } else {
        return { success: false, error: '잘못된 타입입니다.' };
      }
      
      // Firestore 업데이트 (undefined 방지)
      await userRef.update({
        freeSummaryRemaining: credits.freeSummaryRemaining || 0,
        freeDetailRemaining: credits.freeDetailRemaining || 0,
        freeRemaining: credits.freeRemaining || 0,
        paidBalance: credits.paidBalance || 0,
        lastResetMonth: credits.lastResetMonth || new Date().toISOString().slice(0, 7)
      });
      
      // 사용 내역 기록 (서브컬렉션)
      await userRef.collection('usageHistory').add({
        type,
        cost,
        usedFree: usedFreeType !== null,
        date: new Date().toISOString(),
        freeSummaryRemainingAfter: credits.freeSummaryRemaining || 0,
        freeDetailRemainingAfter: credits.freeDetailRemaining || 0,
        paidBalanceAfter: credits.paidBalance || 0
      });
      
      // pointLogs에도 사용 내역 기록 (관리자 페이지 조회용)
      if (cost > 0) {
        const userEmail = context.auth.token.email || credits.email || '';
        const userName = credits.name || credits.displayName || '';
        await db.collection('pointLogs').add({
          uid: userId,
          email: userEmail,
          name: userName,
          type: type === 'summary' ? 'summary_use' : 'detail_use',
          amount: -cost,
          description: type === 'summary' ? '요약분석 사용' : '상세분석 사용',
          balanceBefore: (credits.paidBalance || 0) + cost,
          balanceAfter: credits.paidBalance || 0,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
      
      return {
        success: true,
        credits: {
          freeSummaryRemaining: credits.freeSummaryRemaining || 0,
          freeDetailRemaining: credits.freeDetailRemaining || 0,
          freeRemaining: credits.freeRemaining || 0,
          paidBalance: credits.paidBalance || 0,
          lastResetMonth: credits.lastResetMonth
        },
        // ★ 클라이언트에서 정확한 메시지 표시용
        usedFree: usedFreeType !== null,  // 무료 사용 여부
        cost: cost,                        // 실제 차감 포인트 (무료면 0)
        usedFreeType: usedFreeType         // 'summary' | 'detail' | null
      };
      
    } catch (error) {
      console.error('❌ 크레딧 차감 오류:', error);
      return { success: false, error: error.message };
    }
  });

/**
 * 크레딧 충전 (관리자용)
 */
exports.addCredits = functions
  .region('asia-northeast3')
  .https.onCall(async (data, context) => {
    try {
      // 인증 확인
      if (!context.auth) {
        return { success: false, error: '로그인이 필요합니다.' };
      }
      
      const { targetUserId, amount } = data;
      
      // 관리자 확인 (이메일 기반)
      const adminEmails = ['polarislkh@naver.com', 'kfp_center@naver.com', 'polarislkh@gmail.com'];
      const callerEmail = context.auth.token.email;
      
      if (!adminEmails.includes(callerEmail)) {
        return { success: false, error: '관리자 권한이 필요합니다.' };
      }
      
      if (!targetUserId || !amount || amount <= 0) {
        return { success: false, error: '유효하지 않은 요청입니다.' };
      }
      
      // 대상 사용자 크레딧 업데이트
      const userRef = db.collection('users').doc(targetUserId);
      const userDoc = await userRef.get();
      
      let currentBalance = 0;
      if (userDoc.exists) {
        currentBalance = userDoc.data().paidBalance || 0;
        await userRef.update({
          paidBalance: currentBalance + amount
        });
      } else {
        // 신규 사용자 생성
        const currentMonth = new Date().toISOString().slice(0, 7);
        await userRef.set({
          freeRemaining: 10,
          paidBalance: amount,
          lastResetMonth: currentMonth,
          createdAt: new Date().toISOString()
        });
      }
      
      // 충전 내역 기록
      await userRef.collection('chargeHistory').add({
        amount,
        date: new Date().toISOString(),
        chargedBy: callerEmail
      });
      
      console.log(`💰 크레딧 충전: ${targetUserId}에게 ${amount}P (by ${callerEmail})`);
      
      return {
        success: true,
        message: `${amount}P가 충전되었습니다.`
      };
      
    } catch (error) {
      console.error('❌ 크레딧 충전 오류:', error);
      return { success: false, error: error.message };
    }
  });

// ============================================================
// 6. scheduledBizinfoFetch - 1시간마다 자동 공고 수집 (캐싱)
// ============================================================
exports.scheduledBizinfoFetch = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .pubsub
  .schedule('every 1 hours')
  .timeZone('Asia/Seoul')
  .onRun(async (context) => {
    try {
      console.log('⏰ [자동수집] 기업마당 공고 수집 시작...');
      
      const BIZINFO_API_KEY = getBizinfoApiKey();
      if (!BIZINFO_API_KEY) {
        console.error('❌ BIZINFO_API_KEY가 설정되지 않았습니다.');
        return null;
      }
      
      let allPrograms = [];
      
      // 500페이지까지 수집 (최대 50,000개 - 전체 공고 수집)
      for (let page = 1; page <= 500; page++) {
        const apiUrl = `https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do?crtfcKey=${BIZINFO_API_KEY}&dataType=json&searchCnt=50000&pageUnit=100&pageIndex=${page}`;
        
        try {
          // 30초 타임아웃 설정
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 30000);
          
          const response = await fetch(apiUrl, { signal: controller.signal });
          clearTimeout(timeoutId);
          
          if (!response.ok) {
            console.error(`❌ API 오류 (페이지 ${page}):`, response.status);
            break;
          }
          
          const text = await response.text();
          let apiData;
          try {
            apiData = JSON.parse(text);
          } catch (e) {
            console.error('❌ JSON 파싱 실패');
            break;
          }
        
          let programs = [];
          if (apiData?.jsonArray?.item) {
            programs = Array.isArray(apiData.jsonArray.item) ? apiData.jsonArray.item : [apiData.jsonArray.item];
          } else if (Array.isArray(apiData?.jsonArray)) {
            programs = apiData.jsonArray;
          }
        
          if (programs.length === 0) break;
        
          allPrograms = allPrograms.concat(programs);
          console.log(`📥 페이지 ${page}: ${programs.length}개 수집`);
        
          if (programs.length < 100) break; // 마지막 페이지
          
        } catch (fetchError) {
          console.error(`❌ 페이지 ${page} 가져오기 오류:`, fetchError.message);
          if (page === 1) {
            console.error('❌ 첫 페이지부터 오류 발생, 수집 중단');
            return null;
          }
          break;
        }
      }
      
      console.log(`📦 총 ${allPrograms.length}개 공고 수집 완료, 필터링 시작...`);
      
      // 필터링 조건: 마감일 지난 것만 제외 (수동 수집과 동일)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // 날짜 문자열에서 숫자만 추출하는 헬퍼 함수
      const extractDateNumbers = (str) => {
        if (!str) return '';
        return str.replace(/[^0-9]/g, '').substring(0, 8);
      };
      
      const openPrograms = allPrograms.filter(item => {
        // 마감일 체크
        const period = item.reqstBeginEndDe || '';
        
        // 날짜 없거나 '~' 없으면 포함 (상시모집, 예산소진시까지 등)
        if (!period || !period.includes('~')) return true;
        
        const endDateStr = extractDateNumbers(period.split('~')[1]);
        
        // 마감일 형식이 안맞으면 포함 (비정형 데이터)
        if (endDateStr.length < 8) return true;
        
        // 마감일 파싱
        const endDate = new Date(
          endDateStr.substring(0, 4) + '-' +
          endDateStr.substring(4, 6) + '-' +
          endDateStr.substring(6, 8)
        );
        
        // 파싱 실패하면 포함
        if (isNaN(endDate.getTime())) return true;
        
        // 마감일 지난 것만 제외
        return endDate >= today;
      });
      
      console.log(`✅ 필터링 완료: ${openPrograms.length}개 (마감일 기준 ${allPrograms.length - openPrograms.length}개 제외)`);
      
      // Firestore에 저장
      let batch = db.batch();
      let savedCount = 0;
      
      for (const item of openPrograms) {
        const programId = item.pblancId || item.seq || `bizinfo-${savedCount}`;
        const docRef = db.collection('bizinfo_cache').doc(programId);
        
        const programData = {
          id: programId,
          name: item.pblancNm || item.title || '',
          organization: item.jrsdInsttNm || item.author || '',
          executor: item.excInsttNm || '',
          category: item.pldirSportRealmLclasCodeNm || item.lcategory || '',
          target: item.trgetNm || '',
          description: item.bsnsSumryCn || item.description || '',
          applicationMethod: item.reqstMthPapersCn || '',
          contact: item.refrncNm || '',
          applicationUrl: item.rceptEngnHmpgUrl || '',
          detailUrl: item.pblancUrl || item.link || '',
          applicationPeriod: item.reqstBeginEndDe || item.reqstDt || '',
          registeredDate: item.creatPnttm || item.pubDate || '',
          hashTags: item.hashTags || '',
          views: parseInt(item.inqireCo) || 0,
          attachmentUrl: item.flpthNm || '',
          attachmentName: item.fileNm || '',
          printFileUrl: item.printFlpthNm || '',
          printFileName: item.printFileNm || '',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        
        batch.set(docRef, programData, { merge: true });
        savedCount++;
        
        // Firestore batch는 500개 제한
        if (savedCount % 450 === 0) {
          await batch.commit();
          console.log(`💾 ${savedCount}개 저장 중...`);
          batch = db.batch();
        }
      }
      
      await batch.commit();
      
      // 수집 메타 정보 저장
      await db.collection('bizinfo_cache').doc('_meta').set({
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        totalCount: savedCount,
        lastUpdatedKST: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
        triggeredBy: '자동수집'
      });
      
      console.log(`✅ [자동수집] 완료: ${savedCount}개 저장`);
      return null;
      
    } catch (error) {
      console.error('❌ [자동수집] 오류:', error);
      return null;
    }
  });

// ============================================================
// 7. getCachedPrograms - Firestore에서 캐시된 공고 조회 (사용자용)
// ============================================================
exports.getCachedPrograms = functions
  .region('asia-northeast3')
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onCall(async (data, context) => {
    try {
      console.log('📦 [캐시조회] Firestore에서 공고 조회...');
      
      // 메타 정보 확인
      const metaDoc = await db.collection('bizinfo_cache').doc('_meta').get();
      const meta = metaDoc.exists ? metaDoc.data() : null;
      
      // 캐시된 공고 전체 조회
      const snapshot = await db.collection('bizinfo_cache')
        .where(admin.firestore.FieldPath.documentId(), '!=', '_meta')
        .get();
      
      const programs = [];
      snapshot.forEach(doc => {
        const program = doc.data();
        
        // 신청기간 파싱 - 기본값은 진행중(true)
        program.isOpen = true;
        
        if (program.applicationPeriod && program.applicationPeriod.includes('~')) {
          const periods = program.applicationPeriod.split('~').map(s => s.trim());
          if (periods.length === 2) {
            program.applicationStart = periods[0];
            program.applicationEnd = periods[1];
            
            // 마감일에서 숫자만 추출
            const endDateStr = periods[1].replace(/[^0-9]/g, '').substring(0, 8);
            
            // 8자리 숫자(YYYYMMDD)인 경우만 날짜 비교
            if (endDateStr.length === 8) {
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const endDate = new Date(
                endDateStr.substring(0, 4) + '-' +
                endDateStr.substring(4, 6) + '-' +
                endDateStr.substring(6, 8)
              );
              // 날짜 파싱 성공 시에만 마감 여부 판단
              if (!isNaN(endDate.getTime())) {
                program.isOpen = endDate >= today;
              }
            }
          }
        }
        
        // 🔥 마감 공고 제외 (isOpen이 false면 반환하지 않음)
        if (program.isOpen === false) return;
        
        programs.push(program);
      });
      
      // 통계 계산
      const stats = {
        total: programs.length,
        byCategory: {},
        openCount: programs.filter(p => p.isOpen).length
      };
      
      programs.forEach(p => {
        const cat = p.category || '기타';
        stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;
      });
      
      console.log(`✅ [캐시조회] ${programs.length}개 공고 반환`);
      
      return {
        success: true,
        totalCount: programs.length,
        stats: stats,
        programs: programs,
        lastUpdated: meta?.lastUpdatedKST || '정보없음',
        fromCache: true,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('❌ [캐시조회] 오류:', error);
      return {
        success: false,
        error: error.message,
        programs: [],
        fromCache: false
      };
    }
  });

// ============================================================
// 8. manualBizinfoFetch - 관리자 수동 공고 수집
// ============================================================
exports.manualBizinfoFetch = functions
  .region('asia-northeast3')
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onCall(async (data, context) => {
    try {
      console.log('🔄 [수동수집] 공고 수집 시작...');
      
      const BIZINFO_API_KEY = getBizinfoApiKey();
      if (!BIZINFO_API_KEY) {
        return { success: false, error: 'API 키가 설정되지 않았습니다.' };
      }
      
      let allPrograms = [];
      
      for (let page = 1; page <= 500; page++) {
        const apiUrl = `https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do?crtfcKey=${BIZINFO_API_KEY}&dataType=json&searchCnt=50000&pageUnit=100&pageIndex=${page}`;
        
        try {
          // 30초 타임아웃 설정
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 30000);
          
          const response = await fetch(apiUrl, { signal: controller.signal });
          clearTimeout(timeoutId);
          
          if (!response.ok) {
            console.log(`⚠️ 페이지 ${page} 응답 오류: ${response.status}`);
            break;
          }
          
          const apiData = await response.json();
          
          let programs = [];
          if (apiData?.jsonArray?.item) {
            programs = Array.isArray(apiData.jsonArray.item) ? apiData.jsonArray.item : [apiData.jsonArray.item];
          } else if (Array.isArray(apiData?.jsonArray)) {
            programs = apiData.jsonArray;
          }
          
          if (programs.length === 0) break;
          allPrograms = allPrograms.concat(programs);
          console.log(`📥 페이지 ${page}: ${programs.length}개 수집`);
          if (programs.length < 100) break;
          
        } catch (fetchError) {
          console.error(`❌ 페이지 ${page} 가져오기 오류:`, fetchError.message);
          if (page === 1) {
            return { success: false, error: `API 호출 실패: ${fetchError.message}` };
          }
          break; // 다른 페이지 오류면 현재까지 수집한 것으로 진행
        }
      }
      
      console.log(`📦 총 ${allPrograms.length}개 수집 완료, 필터링 시작...`);
      
      // 필터링 조건: 마감일 지난 것만 제외 (날짜 없거나 비정형은 포함)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // 날짜 문자열에서 숫자만 추출하는 헬퍼 함수
      const extractDateNumbers = (str) => {
        if (!str) return '';
        return str.replace(/[^0-9]/g, '').substring(0, 8);
      };
      
      const openPrograms = allPrograms.filter(item => {
        // 마감일 체크
        const period = item.reqstBeginEndDe || '';
        
        // 날짜 없거나 '~' 없으면 포함 (상시모집, 예산소진시까지 등)
        if (!period || !period.includes('~')) return true;
        
        const endDateStr = extractDateNumbers(period.split('~')[1]);
        
        // 마감일 형식이 안맞으면 포함 (비정형 데이터)
        if (endDateStr.length < 8) return true;
        
        // 마감일 파싱
        const endDate = new Date(
          endDateStr.substring(0, 4) + '-' +
          endDateStr.substring(4, 6) + '-' +
          endDateStr.substring(6, 8)
        );
        
        // 파싱 실패하면 포함
        if (isNaN(endDate.getTime())) return true;
        
        // 마감일 지난 것만 제외
        return endDate >= today;
      });
      
      console.log(`✅ 필터링 완료: ${openPrograms.length}개 (마감일 기준 ${allPrograms.length - openPrograms.length}개 제외)`);
      
      // Batch로 저장 (450개씩 묶어서 저장 - 훨씬 빠름)
      let batch = db.batch();
      let savedCount = 0;
      
      for (const item of openPrograms) {
        const programId = item.pblancId || `bizinfo-${savedCount}`;
        const docRef = db.collection('bizinfo_cache').doc(programId);
        
        batch.set(docRef, {
          id: programId,
          name: item.pblancNm || '',
          organization: item.jrsdInsttNm || '',
          executor: item.excInsttNm || '',
          category: item.pldirSportRealmLclasCodeNm || '',
          target: item.trgetNm || '',
          description: item.bsnsSumryCn || '',
          applicationMethod: item.reqstMthPapersCn || '',
          contact: item.refrncNm || '',
          applicationUrl: item.rceptEngnHmpgUrl || '',
          detailUrl: item.pblancUrl || '',
          applicationPeriod: item.reqstBeginEndDe || '',
          registeredDate: item.creatPnttm || '',
          hashTags: item.hashTags || '',
          views: parseInt(item.inqireCo) || 0,
          attachmentUrl: item.flpthNm || '',
          attachmentName: item.fileNm || '',
          printFileUrl: item.printFlpthNm || '',
          printFileName: item.printFileNm || '',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        
        savedCount++;
        
        // 450개마다 commit (Firestore batch 500개 제한)
        if (savedCount % 450 === 0) {
          await batch.commit();
          console.log(`💾 ${savedCount}개 저장 완료...`);
          batch = db.batch();
        }
      }
      
      // 나머지 저장
      await batch.commit();
      
      await db.collection('bizinfo_cache').doc('_meta').set({
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        totalCount: savedCount,
        lastUpdatedKST: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
        triggeredBy: 'manual'
      });
      
      console.log(`✅ [수동수집] 완료: ${savedCount}개 저장`);
      
      return {
        success: true,
        message: `${savedCount}개 공고가 수집되었습니다.`,
        count: savedCount
      };
      
    } catch (error) {
      console.error('❌ [수동수집] 오류:', error);
      return { success: false, error: error.message };
    }
  });

// ============================================================
// 9. getBizinfoCacheStatus - 캐시 상태 조회 (관리자용)
// ============================================================
exports.getBizinfoCacheStatus = functions
  .region('asia-northeast3')
  .https.onCall(async (data, context) => {
    try {
      const metaDoc = await db.collection('bizinfo_cache').doc('_meta').get();
      
      if (!metaDoc.exists) {
        return {
          success: true,
          status: {
            totalCount: 0,
            lastUpdated: '수집된 적 없음',
            message: '아직 공고가 수집되지 않았습니다.'
          }
        };
      }
      
      const meta = metaDoc.data();
      
      return {
        success: true,
        status: {
          totalCount: meta.totalCount || 0,
          lastUpdated: meta.lastUpdatedKST || '정보없음',
          triggeredBy: meta.triggeredBy || '자동수집'
        }
      };
      
    } catch (error) {
      return { success: false, error: error.message };
    }
  });


// ============================================================
// 8. getKsicData - KSIC 산업분류코드 조회
// ============================================================
exports.getKsicData = functions
  .region('asia-northeast3')
  .runWith({ timeoutSeconds: 10, memory: '256MB' })
  .https.onCall(async (data, context) => {
    const ksicData = [{"code":"01","name":"농업"},{"code":"02","name":"임업"},{"code":"03","name":"어업"},{"code":"05","name":"석탄, 원유 및 천연가스 광업"},{"code":"06","name":"금속 광업"},{"code":"07","name":"비금속광물 광업"},{"code":"08","name":"광업 지원 서비스업"},{"code":"10","name":"식료품 제조업"},{"code":"11","name":"음료 제조업"},{"code":"12","name":"담배 제조업"},{"code":"13","name":"섬유제품 제조업"},{"code":"14","name":"의복, 의복액세서리 및 모피제품 제조업"},{"code":"15","name":"가죽, 가방 및 신발 제조업"},{"code":"16","name":"목재 및 나무제품 제조업"},{"code":"17","name":"펄프, 종이 및 종이제품 제조업"},{"code":"18","name":"인쇄 및 기록매체 복제업"},{"code":"19","name":"코크스, 연탄 및 석유정제품 제조업"},{"code":"20","name":"화학물질 및 화학제품 제조업"},{"code":"21","name":"의료용 물질 및 의약품 제조업"},{"code":"22","name":"고무제품 및 플라스틱제품 제조업"},{"code":"23","name":"비금속 광물제품 제조업"},{"code":"24","name":"1차 금속 제조업"},{"code":"25","name":"금속가공제품 제조업"},{"code":"26","name":"전자부품, 컴퓨터, 영상, 음향 및 통신장비 제조업"},{"code":"27","name":"의료, 정밀, 광학기기 및 시계 제조업"},{"code":"28","name":"전기장비 제조업"},{"code":"29","name":"기타 기계 및 장비 제조업"},{"code":"30","name":"자동차 및 트레일러 제조업"},{"code":"31","name":"기타 운송장비 제조업"},{"code":"32","name":"가구 제조업"},{"code":"33","name":"기타 제품 제조업"},{"code":"34","name":"산업용 기계 및 장비 수리업"},{"code":"35","name":"전기, 가스, 증기 및 공기조절 공급업"},{"code":"36","name":"수도업"},{"code":"37","name":"하수, 폐수 및 분뇨 처리업"},{"code":"38","name":"폐기물 수집, 운반, 처리 및 원료 재생업"},{"code":"39","name":"환경 정화 및 복원업"},{"code":"41","name":"종합 건설업"},{"code":"42","name":"전문직별 공사업"},{"code":"45","name":"자동차 및 부품 판매업"},{"code":"46","name":"도매 및 상품중개업"},{"code":"47","name":"소매업"},{"code":"49","name":"육상운송 및 파이프라인 운송업"},{"code":"50","name":"수상 운송업"},{"code":"51","name":"항공 운송업"},{"code":"52","name":"창고 및 운송관련 서비스업"},{"code":"55","name":"숙박업"},{"code":"56","name":"음식점 및 주점업"},{"code":"58","name":"출판업"},{"code":"59","name":"영상·오디오 기록물 제작 및 배급업"},{"code":"60","name":"방송업"},{"code":"61","name":"우편 및 통신업"},{"code":"62","name":"컴퓨터 프로그래밍, 시스템 통합 및 관리업"},{"code":"63","name":"정보서비스업"},{"code":"64","name":"금융업"},{"code":"65","name":"보험 및 연금업"},{"code":"66","name":"금융 및 보험 관련 서비스업"},{"code":"68","name":"부동산업"},{"code":"70","name":"연구개발업"},{"code":"71","name":"전문 서비스업"},{"code":"72","name":"건축기술, 엔지니어링 및 기타 과학기술 서비스업"},{"code":"73","name":"기타 전문, 과학 및 기술 서비스업"},{"code":"74","name":"사업시설 관리 및 조경 서비스업"},{"code":"75","name":"사업지원 서비스업"},{"code":"76","name":"임대업"},{"code":"84","name":"공공 행정, 국방 및 사회보장 행정"},{"code":"85","name":"교육 서비스업"},{"code":"86","name":"보건업"},{"code":"87","name":"사회복지 서비스업"},{"code":"90","name":"창작, 예술 및 여가관련 서비스업"},{"code":"91","name":"스포츠 및 오락관련 서비스업"},{"code":"94","name":"협회 및 단체"},{"code":"95","name":"수리업"},{"code":"96","name":"기타 개인 서비스업"},{"code":"97","name":"가구 내 고용활동"},{"code":"98","name":"자가 소비 생산활동"},{"code":"99","name":"국제 및 외국기관"},{"code":"011","name":"작물 재배업"},{"code":"012","name":"축산업"},{"code":"013","name":"작물재배 및 축산 복합농업"},{"code":"014","name":"작물재배 및 축산 관련 서비스업"},{"code":"015","name":"수렵 및 관련 서비스업"},{"code":"020","name":"임업"},{"code":"031","name":"어로 어업"},{"code":"032","name":"양식어업 및 어업관련 서비스업"},{"code":"051","name":"석탄 광업"},{"code":"052","name":"원유 및 천연가스 채굴업"},{"code":"061","name":"철 광업"},{"code":"062","name":"비철금속 광업"},{"code":"071","name":"토사석 광업"},{"code":"072","name":"기타 비금속광물 광업"},{"code":"080","name":"광업 지원 서비스업"},{"code":"101","name":"도축, 육류 가공 및 저장 처리업"},{"code":"102","name":"수산물 가공 및 저장 처리업"},{"code":"103","name":"과실, 채소 가공 및 저장 처리업"},{"code":"104","name":"동·식물성 유지 및 낙농제품"},{"code":"105","name":"곡물가공품, 전분 및 전분제품"},{"code":"106","name":"떡, 빵 및 과자류 제조업"},{"code":"107","name":"도시락 및 식사용 조리식품 제조업"},{"code":"108","name":"기타 식품 제조업"},{"code":"109","name":"동물용 사료 및 조제식품 제조업"},{"code":"111","name":"알코올음료 제조업"},{"code":"112","name":"비알코올음료 및 얼음 제조업"},{"code":"120","name":"담배 제조업"},{"code":"131","name":"방적 및 가공사 제조업"},{"code":"132","name":"직물직조 및 직물제품 제조업"},{"code":"133","name":"편조원단 제조업"},{"code":"134","name":"섬유제품 염색, 정리 및 마무리"},{"code":"139","name":"기타 섬유제품 제조업"},{"code":"141","name":"봉제의복 제조업"},{"code":"142","name":"모피제품 제조업"},{"code":"143","name":"편조의복 제조업"},{"code":"144","name":"의복 액세서리 제조업"},{"code":"151","name":"가죽, 가방 및 유사제품 제조업"},{"code":"152","name":"신발 및 신발 부분품 제조업"},{"code":"161","name":"제재 및 목재 가공업"},{"code":"162","name":"나무제품 제조업"},{"code":"163","name":"코르크 및 조물 제품 제조업"},{"code":"171","name":"펄프, 종이 및 판지 제조업"},{"code":"172","name":"골판지, 종이 상자 및 종이 용기 제조업"},{"code":"179","name":"기타 종이 및 판지 제품 제조업"},{"code":"181","name":"인쇄 및 인쇄관련 산업"},{"code":"182","name":"기록매체 복제업"},{"code":"191","name":"코크스 및 연탄 제조업"},{"code":"192","name":"석유 정제품 제조업"},{"code":"201","name":"기초 화학물질 제조업"},{"code":"202","name":"합성고무 및 플라스틱 물질"},{"code":"203","name":"비료, 농약 및 살균, 살충제"},{"code":"204","name":"기타 화학제품 제조업"},{"code":"205","name":"화학섬유 제조업"},{"code":"211","name":"기초 의약 물질 제조업"},{"code":"212","name":"의약품 제조업"},{"code":"213","name":"의료용품 및 기타 의약 관련제품"},{"code":"221","name":"고무제품 제조업"},{"code":"222","name":"플라스틱제품 제조업"},{"code":"231","name":"유리 및 유리제품 제조업"},{"code":"232","name":"내화, 비내화 요업제품 제조업"},{"code":"233","name":"시멘트, 석회, 플라스터 및 그"},{"code":"239","name":"기타 비금속 광물제품 제조업"},{"code":"241","name":"1차 철강 제조업"},{"code":"242","name":"1차 비철금속 제조업"},{"code":"243","name":"금속 주조업"},{"code":"251","name":"구조용 금속제품, 탱크 및 증기발생기 제조업"},{"code":"252","name":"무기 및 총포탄 제조업"},{"code":"259","name":"기타 금속 가공제품 제조업"},{"code":"261","name":"반도체 제조업"},{"code":"262","name":"전자부품 제조업"},{"code":"263","name":"컴퓨터 및 주변장치 제조업"},{"code":"264","name":"통신 및 방송 장비 제조업"},{"code":"265","name":"영상 및 음향기기 제조업"},{"code":"266","name":"마그네틱 및 광학 매체 제조업"},{"code":"271","name":"의료용 기기 제조업"},{"code":"272","name":"측정, 시험, 항해, 제어 및 기타"},{"code":"273","name":"사진장비 및 광학기기 제조업"},{"code":"281","name":"전동기, 발전기 및 전기 변환"},{"code":"282","name":"일차전지 및 이차전지 제조업"},{"code":"283","name":"절연선 및 케이블 제조업"},{"code":"284","name":"전구 및 조명장치 제조업"},{"code":"285","name":"가정용 기기 제조업"},{"code":"289","name":"기타 전기장비 제조업"},{"code":"291","name":"일반 목적용 기계 제조업"},{"code":"292","name":"특수 목적용 기계 제조업"},{"code":"301","name":"자동차용 엔진 및 자동차 제조업"},{"code":"302","name":"자동차 차체나 트레일러 제조업"},{"code":"303","name":"자동차 신품 부품 제조업"},{"code":"304","name":"자동차 재제조 부품 제조업"},{"code":"311","name":"선박 및 보트 건조업"},{"code":"312","name":"철도장비 제조업"},{"code":"313","name":"항공기, 우주선 및 부품 제조업"},{"code":"319","name":"기타 운송장비 제조업"},{"code":"320","name":"가구 제조업"},{"code":"331","name":"귀금속 및 장신용품 제조업"},{"code":"332","name":"악기 제조업"},{"code":"333","name":"운동 및 경기용구 제조업"},{"code":"334","name":"인형, 장난감 및 오락용품 제조업"},{"code":"339","name":"그 외 기타 제품 제조업"},{"code":"340","name":"산업용 기계 및 장비 수리업"},{"code":"351","name":"전기업"},{"code":"352","name":"연료용 가스 제조 및 배관공급업"},{"code":"353","name":"증기, 냉"},{"code":"360","name":"수도업"},{"code":"370","name":"하수, 폐수 및 분뇨 처리업"},{"code":"381","name":"폐기물 수집, 운반업"},{"code":"382","name":"폐기물 처리업"},{"code":"383","name":"해체, 선별 및 원료 재생업"},{"code":"390","name":"환경 정화 및 복원업"},{"code":"411","name":"건물 건설업"},{"code":"412","name":"토목 건설업"},{"code":"421","name":"기반 조성 및 시설물 공사업"},{"code":"422","name":"건물설비 설치 공사업"},{"code":"423","name":"전기 및 통신 공사업"},{"code":"424","name":"실내건축 및 건축마무리 공사업"},{"code":"425","name":"시설물 유지관리 공사업"},{"code":"426","name":"건설장비 운영업"},{"code":"451","name":"자동차 판매업"},{"code":"452","name":"자동차 부품 및 내장품 판매업"},{"code":"453","name":"모터사이클 및 부품 판매업"},{"code":"461","name":"상품 중개업"},{"code":"462","name":"산업용 농축산물 및 동식물 도매업"},{"code":"463","name":"음식료품 및 담배 도매업"},{"code":"464","name":"생활용품 도매업"},{"code":"465","name":"기계장비 및 관련 물품 도매업"},{"code":"466","name":"건축자재, 철물 및 난방장치"},{"code":"467","name":"기타 전문 도매업"},{"code":"468","name":"상품 종합 도매업"},{"code":"471","name":"종합 소매업"},{"code":"472","name":"음식료품 및 담배 소매업"},{"code":"473","name":"가전제품 및 정보통신장비 소매업"},{"code":"474","name":"섬유, 의복, 신발 및 가죽제품"},{"code":"475","name":"기타 생활용품 소매업"},{"code":"476","name":"문화, 오락 및 여가 용품 소매업"},{"code":"477","name":"연료 소매업"},{"code":"478","name":"무점포 소매업"},{"code":"479","name":"무점포 소매업"},{"code":"491","name":"철도 운송업"},{"code":"492","name":"육상 여객 운송업"},{"code":"493","name":"도로 화물 운송업"},{"code":"494","name":"소화물 전문 운송업"},{"code":"495","name":"파이프라인 운송업"},{"code":"501","name":"해상 운송업"},{"code":"502","name":"내륙 수상 및 항만 내 운송업"},{"code":"511","name":"항공 여객 운송업"},{"code":"512","name":"항공 화물 운송업"},{"code":"521","name":"보관 및 창고업"},{"code":"529","name":"기타 운송관련 서비스업"},{"code":"551","name":"일반 및 생활 숙박시설 운영업"},{"code":"559","name":"기타 숙박업"},{"code":"561","name":"음식점업"},{"code":"562","name":"주점 및 비알코올 음료점업"},{"code":"581","name":"출판업"},{"code":"582","name":"소프트웨어 개발 및 공급업"},{"code":"591","name":"영화, 비디오물, 방송프로그램"},{"code":"592","name":"오디오물 출판 및 원판 녹음업"},{"code":"601","name":"라디오 방송업"},{"code":"602","name":"텔레비전 방송업"},{"code":"603","name":"영상·오디오물 제공 서비스업"},{"code":"611","name":"공영 우편업"},{"code":"612","name":"전기 통신업"},{"code":"620","name":"컴퓨터 프로그래밍, 시스템 통합 및 관리업"},{"code":"631","name":"자료처리, 호스팅, 포털 및 기타"},{"code":"639","name":"기타 정보 서비스업"},{"code":"641","name":"은행 및 저축기관"},{"code":"642","name":"신탁업 및 집합투자업"},{"code":"649","name":"기타 금융업"},{"code":"651","name":"보험업"},{"code":"652","name":"재 보험업"},{"code":"653","name":"공제업"},{"code":"661","name":"금융 지원 서비스업"},{"code":"662","name":"보험 및 연금 관련 서비스업"},{"code":"681","name":"부동산 임대 및 공급업"},{"code":"682","name":"부동산 관련 서비스업"},{"code":"701","name":"자연과학 및 공학 연구개발업"},{"code":"702","name":"인문 및 사회과학 연구개발업"},{"code":"711","name":"법무관련 서비스업"},{"code":"712","name":"회계 및 세무관련 서비스업"},{"code":"713","name":"광고업"},{"code":"714","name":"시장조사 및 여론조사업"},{"code":"715","name":"회사 본부 및 경영 컨설팅 서비스업"},{"code":"716","name":"기타 전문 서비스업"},{"code":"721","name":"건축기술, 엔지니어링 및 관련"},{"code":"729","name":"기타 과학기술 서비스업"},{"code":"731","name":"수의업"},{"code":"732","name":"전문 디자인업"},{"code":"733","name":"사진 촬영 및 처리업"},{"code":"739","name":"그 외 기타 전문, 과학 및 기술"},{"code":"741","name":"사업시설 유지"},{"code":"742","name":"건물 및 산업설비 청소업"},{"code":"743","name":"조경 관리 및 유지 서비스업"},{"code":"751","name":"고용알선 및 인력공급업"},{"code":"752","name":"여행사 및 기타 여행보조"},{"code":"753","name":"경비, 경호 및 탐정업"},{"code":"759","name":"기타 사업지원 서비스업"},{"code":"761","name":"운송장비 임대업"},{"code":"762","name":"개인 및 가정용품 임대업"},{"code":"763","name":"산업용 기계 및 장비 임대업"},{"code":"764","name":"무형재산권 임대업"},{"code":"841","name":"입법 및 일반 정부 행정"},{"code":"842","name":"사회 및 산업정책 행정"},{"code":"843","name":"외무 및 국방 행정"},{"code":"844","name":"사법 및 공공질서 행정"},{"code":"845","name":"사회보장 행정"},{"code":"846","name":"사회보장보험업 및 연금업"},{"code":"851","name":"초등 교육기관"},{"code":"852","name":"중등 교육기관"},{"code":"853","name":"고등 교육기관"},{"code":"854","name":"특수학교, 외국인학교 및"},{"code":"855","name":"일반 교습 학원"},{"code":"856","name":"기타 교육기관"},{"code":"857","name":"교육지원 서비스업"},{"code":"861","name":"병원"},{"code":"862","name":"의원"},{"code":"863","name":"공중 보건 의료업"},{"code":"869","name":"기타 보건업"},{"code":"871","name":"거주 복지시설 운영업"},{"code":"872","name":"비거주 복지시설 운영업"},{"code":"901","name":"창작 및 예술관련 서비스업"},{"code":"902","name":"도서관, 사적지 및 유사 여가관련"},{"code":"911","name":"스포츠 서비스업"},{"code":"912","name":"유원지 및 기타 오락관련"},{"code":"941","name":"산업 및 전문가 단체"},{"code":"942","name":"노동조합"},{"code":"949","name":"기타 협회 및 단체"},{"code":"951","name":"컴퓨터 및 통신장비 수리업"},{"code":"952","name":"자동차 및 모터사이클 수리업"},{"code":"953","name":"개인 및 가정용품 수리업"},{"code":"961","name":"미용, 욕탕 및 유사 서비스업"},{"code":"969","name":"그 외 기타 개인 서비스업"},{"code":"970","name":"가구 내 고용활동"},{"code":"981","name":"자가 소비를 위한 가사 생산 활동"},{"code":"982","name":"자가 소비를 위한 가사 서비스"},{"code":"990","name":"국제 및 외국기관"},{"code":"0111","name":"곡물 및 기타 식량작물 재배업"},{"code":"0112","name":"채소, 화훼작물 및 종묘 재배업"},{"code":"0113","name":"과실, 음료용 및 향신용 작물"},{"code":"0114","name":"기타 작물 재배업"},{"code":"0115","name":"시설작물 재배업"},{"code":"0121","name":"소 사육업"},{"code":"0122","name":"양돈업"},{"code":"0123","name":"가금류 및 조류 사육업"},{"code":"0129","name":"기타 축산업"},{"code":"0130","name":"작물재배 및 축산 복합농업"},{"code":"0141","name":"작물재배 관련 서비스업"},{"code":"0142","name":"축산 관련 서비스업"},{"code":"0150","name":"수렵 및 관련 서비스업"},{"code":"0201","name":"영림업"},{"code":"0202","name":"벌목업"},{"code":"0203","name":"임산물 채취업"},{"code":"0204","name":"임업 관련 서비스업"},{"code":"0311","name":"해수면 어업"},{"code":"0312","name":"내수면 어업"},{"code":"0321","name":"양식 어업"},{"code":"0322","name":"어업 관련 서비스업"},{"code":"0510","name":"석탄 광업"},{"code":"0520","name":"원유 및 천연가스 채굴업"},{"code":"0610","name":"철 광업"},{"code":"0620","name":"비철금속 광업"},{"code":"0711","name":"석회석 및 점토 광업"},{"code":"0712","name":"석재, 쇄석 및 모래, 자갈 채취업"},{"code":"0721","name":"화학용 및 비료원료용 광물 광업"},{"code":"0722","name":"천일염 생산 및 암염 채취업"},{"code":"0729","name":"그 외 기타 비금속광물 광업"},{"code":"0800","name":"광업 지원 서비스업"},{"code":"1011","name":"도축업"},{"code":"1012","name":"육류 가공 및 저장 처리업"},{"code":"1021","name":"수산동물 가공 및 저장 처리업"},{"code":"1022","name":"수산식물 가공 및 저장 처리업"},{"code":"1030","name":"과실, 채소 가공 및 저장 처리업"},{"code":"1041","name":"동물성 및 식물성 유지 제조업"},{"code":"1042","name":"낙농제품 및 식용빙과류 제조업"},{"code":"1051","name":"곡물 가공품 제조업"},{"code":"1052","name":"전분제품 및 당류 제조업"},{"code":"1060","name":"떡, 빵 및 과자류 제조업"},{"code":"1070","name":"도시락 및 식사용 조리식품"},{"code":"1080","name":"동물용 사료 및 조제식품 제조업"},{"code":"1081","name":"설탕 제조업"},{"code":"1082","name":"면류, 마카로니 및 유사식품"},{"code":"1083","name":"조미료 및 식품 첨가물 제조업"},{"code":"1089","name":"기타 식료품 제조업"},{"code":"1090","name":"동물용 사료 및 조제식품 제조업"},{"code":"1111","name":"발효주 제조업"},{"code":"1112","name":"증류주 및 합성주 제조업"},{"code":"1120","name":"비알코올 음료 및 얼음 제조업"},{"code":"1200","name":"담배 제조업"},{"code":"1310","name":"방적 및 가공사 제조업"},{"code":"1321","name":"직물 직조업"},{"code":"1322","name":"직물제품 제조업"},{"code":"1330","name":"편조원단 제조업"},{"code":"1340","name":"섬유제품 염색, 정리 및 마무리"},{"code":"1391","name":"카펫, 마루덮개 및 유사제품"},{"code":"1392","name":"끈, 로프, 망 및 끈 가공품 제조업"},{"code":"1399","name":"그 외 기타 섬유제품 제조업"},{"code":"1411","name":"작물재배 지원 서비스업"},{"code":"1412","name":"농산물 건조, 선별 및 기타 수확 후 서비스업"},{"code":"1413","name":"한복 제조업"},{"code":"1419","name":"기타 봉제의복 제조업"},{"code":"1420","name":"축산 관련 서비스업"},{"code":"1430","name":"편조의복 제조업"},{"code":"1441","name":"편조의복 액세서리 제조업"},{"code":"1449","name":"기타 의복 액세서리 제조업"},{"code":"1511","name":"모피 및 가죽 제조업"},{"code":"1512","name":"핸드백, 가방 및 기타 보호용"},{"code":"1519","name":"기타 가죽제품 제조업"},{"code":"1521","name":"신발 제조업"},{"code":"1522","name":"신발 부분품 제조업"},{"code":"1610","name":"제재 및 목재 가공업"},{"code":"1621","name":"박판, 합판 및 강화 목제품"},{"code":"1622","name":"건축용 나무제품 제조업"},{"code":"1623","name":"목재 상자, 드럼 및 적재판"},{"code":"1629","name":"기타 나무제품 제조업"},{"code":"1630","name":"코르크 및 조물 제품 제조업"},{"code":"1710","name":"펄프, 종이 및 판지 제조업"},{"code":"1712","name":"골판지, 종이 상자 및 종이 용기 제조업"},{"code":"1721","name":"골판지 및 골판지 가공제품"},{"code":"1722","name":"종이포대, 판지상자 및 종이용기"},{"code":"1790","name":"기타 종이 및 판지 제품 제조업"},{"code":"1811","name":"인쇄업"},{"code":"1812","name":"인쇄관련 산업"},{"code":"1820","name":"기록매체 복제업"},{"code":"1910","name":"코크스 및 연탄 제조업"},{"code":"1921","name":"원유 정제처리업"},{"code":"1922","name":"석유 정제물 재처리업"},{"code":"2011","name":"임업용 종묘 생산업"},{"code":"2012","name":"육림업"},{"code":"2013","name":"무기안료, 염료, 유연제 및 기타"},{"code":"2020","name":"벌목업"},{"code":"2031","name":"비료 및 질소화합물 제조업"},{"code":"2032","name":"살균·살충제 및 농약 제조업"},{"code":"2041","name":"잉크, 페인트, 코팅제 및 유사제품"},{"code":"2042","name":"세제, 화장품 및 광택제 제조업"},{"code":"2049","name":"그 외 기타 화학제품 제조업"},{"code":"2050","name":"화학섬유 제조업"},{"code":"2110","name":"기초 의약 물질 제조업"},{"code":"2121","name":"완제 의약품 제조업"},{"code":"2122","name":"한의약품 제조업"},{"code":"2123","name":"동물용 의약품 제조업"},{"code":"2130","name":"의료용품 및 기타 의약 관련제품"},{"code":"2211","name":"고무 타이어 및 튜브 제조업"},{"code":"2219","name":"기타 고무제품 제조업"},{"code":"2221","name":"플라스틱 필름, 시트 및 판 제조업"},{"code":"2222","name":"건축용 플라스틱제품 제조업"},{"code":"2223","name":"포장용 플라스틱제품 제조업"},{"code":"2224","name":"기계장비 조립용 플라스틱제품"},{"code":"2225","name":"플라스틱 발포 성형제품 제조업"},{"code":"2229","name":"기타 플라스틱제품 제조업"},{"code":"2311","name":"판유리 및 판유리 가공품 제조업"},{"code":"2312","name":"산업용 유리 제조업"},{"code":"2319","name":"기타 유리제품 제조업"},{"code":"2321","name":"내화 요업제품 제조업"},{"code":"2322","name":"비내화 일반도자기 제조업"},{"code":"2323","name":"건축용 비내화 요업제품 제조업"},{"code":"2331","name":"시멘트, 석회 및 플라스터 제조업"},{"code":"2332","name":"콘크리트, 레미콘 및 기타 시멘트"},{"code":"2391","name":"석제품 제조업"},{"code":"2399","name":"그 외 기타 비금속 광물제품"},{"code":"2411","name":"제철, 제강 및 합금철 제조업"},{"code":"2412","name":"철강 압연, 압출 및 연신제품"},{"code":"2413","name":"철강관 제조업"},{"code":"2419","name":"기타 1차 철강 제조업"},{"code":"2421","name":"비철금속 제련, 정련 및 합금"},{"code":"2422","name":"비철금속 압연, 압출 및 연신제품"},{"code":"2429","name":"기타 1차 비철금속 제조업"},{"code":"2431","name":"철강 주조업"},{"code":"2432","name":"비철금속 주조업"},{"code":"2511","name":"구조용 금속제품 제조업"},{"code":"2512","name":"산업용 난방보일러, 금속탱크 및"},{"code":"2513","name":"핵반응기 및 증기 보일러 제조업"},{"code":"2520","name":"무기 및 총포탄 제조업"},{"code":"2591","name":"금속 단조, 압형 및 분말야금"},{"code":"2592","name":"금속 열처리, 도금 및 기타"},{"code":"2593","name":"날붙이, 수공구 및 일반철물"},{"code":"2594","name":"금속파스너, 스프링 및 금속선"},{"code":"2599","name":"그 외 기타 금속가공제품 제조업"},{"code":"2611","name":"전자집적회로 제조업"},{"code":"2612","name":"다이오드, 트랜지스터 및 유사"},{"code":"2621","name":"표시장치 제조업"},{"code":"2622","name":"인쇄회로기판 및 전자부품"},{"code":"2629","name":"기타 전자부품 제조업"},{"code":"2631","name":"컴퓨터 제조업"},{"code":"2632","name":"기억장치 및 주변기기 제조업"},{"code":"2641","name":"유선 통신장비 제조업"},{"code":"2642","name":"방송 및 무선 통신장비 제조업"},{"code":"2651","name":"텔레비전, 비디오 및 기타"},{"code":"2652","name":"오디오, 스피커 및 기타 음향기기"},{"code":"2660","name":"마그네틱 및 광학 매체 제조업"},{"code":"2711","name":"방사선 장치 및 전기식 진단 기기"},{"code":"2719","name":"기타 의료용 기기 제조업"},{"code":"2721","name":"측정, 시험, 항해, 제어 및 기타"},{"code":"2722","name":"시계 및 시계부품 제조업"},{"code":"2730","name":"사진장비 및 광학기기 제조업"},{"code":"2811","name":"전동기, 발전기 및 전기 변환장치"},{"code":"2812","name":"전기 공급 및 제어장치 제조업"},{"code":"2820","name":"일차전지 및 이차전지 제조업"},{"code":"2830","name":"절연선 및 케이블 제조업"},{"code":"2841","name":"전구 및 램프 제조업"},{"code":"2842","name":"조명장치 제조업"},{"code":"2851","name":"가정용 전기기기 제조업"},{"code":"2852","name":"가정용 비전기식 조리 및 난방"},{"code":"2890","name":"기타 전기장비 제조업"},{"code":"2911","name":"내연기관 및 터빈 제조업"},{"code":"2912","name":"유압기기 제조업"},{"code":"2913","name":"펌프 및 압축기 제조업"},{"code":"2914","name":"베어링, 기어 및 동력전달장치"},{"code":"2915","name":"산업용 오븐, 노 및 노용 버너"},{"code":"2916","name":"산업용 트럭, 승강기 및"},{"code":"2917","name":"냉각, 공기조화, 여과, 증류 및"},{"code":"2918","name":"사무용 기계 및 장비 제조업"},{"code":"2919","name":"기타 일반 목적용 기계 제조업"},{"code":"2921","name":"농업 및 임업용 기계 제조업"},{"code":"2922","name":"가공 공작기계 제조업"},{"code":"2923","name":"금속 주조 및 기타 야금용 기계"},{"code":"2924","name":"건설 및 광업용 기계장비 제조업"},{"code":"2925","name":"음식료품 및 담배 가공기계 제조업"},{"code":"2926","name":"섬유, 의복 및 가죽 가공기계"},{"code":"2927","name":"반도체 및 디스플레이 제조용"},{"code":"2928","name":"산업용 로봇 제조업"},{"code":"2929","name":"기타 특수 목적용 기계 제조업"},{"code":"3011","name":"자동차용 엔진 제조업"},{"code":"3012","name":"자동차 제조업"},{"code":"3020","name":"자동차 차체나 트레일러 제조업"},{"code":"3031","name":"자동차 엔진용 신품 부품 제조업"},{"code":"3032","name":"자동차 차체용 신품 부품 제조업"},{"code":"3033","name":"자동차용 신품 동력전달장치 및"},{"code":"3039","name":"자동차용 기타 신품 부품 제조업"},{"code":"3040","name":"자동차 재제조 부품 제조업"},{"code":"3111","name":"원양 어업"},{"code":"3112","name":"연근해 어업"},{"code":"3120","name":"내수면 어업"},{"code":"3131","name":"항공기, 우주선 및 보조장치"},{"code":"3132","name":"항공기용 엔진 및 부품 제조업"},{"code":"3191","name":"전투용 차량 제조업"},{"code":"3192","name":"모터사이클 및 개인용 전기식"},{"code":"3199","name":"그 외 기타 분류 안된 운송장비"},{"code":"3201","name":"침대 및 내장가구 제조업"},{"code":"3202","name":"목재가구 제조업"},{"code":"3209","name":"기타 가구 제조업"},{"code":"3311","name":"귀금속 및 관련제품 제조업"},{"code":"3312","name":"모조 귀금속 및 모조 장신용품"},{"code":"3320","name":"악기 제조업"},{"code":"3330","name":"운동 및 경기용구 제조업"},{"code":"3340","name":"인형, 장난감 및 오락용품 제조업"},{"code":"3391","name":"간판 및 광고물 제조업"},{"code":"3392","name":"사무 및 회화용품 제조업"},{"code":"3393","name":"가발, 장식용품 및 전시용 모형"},{"code":"3399","name":"그 외 기타 분류 안된 제품"},{"code":"3401","name":"일반 기계류 수리업"},{"code":"3402","name":"전기 및 통신 공사업"},{"code":"3511","name":"발전업"},{"code":"3512","name":"송전 및 배전업"},{"code":"3513","name":"전기 판매업"},{"code":"3520","name":"연료용 가스 제조 및 배관공급업"},{"code":"3530","name":"증기, 냉"},{"code":"3601","name":"생활용수 공급업"},{"code":"3602","name":"산업용수 공급업"},{"code":"3701","name":"하수 및 폐수 처리업"},{"code":"3702","name":"분뇨 처리업"},{"code":"3811","name":"지정 외 폐기물 수집, 운반업"},{"code":"3812","name":"지정 폐기물 수집, 운반업"},{"code":"3813","name":"건설 폐기물 수집, 운반업"},{"code":"3821","name":"지정 외 폐기물 처리업"},{"code":"3822","name":"지정 폐기물 처리업"},{"code":"3823","name":"건설 폐기물 처리업"},{"code":"3824","name":"방사성 폐기물 수집, 운반 및"},{"code":"3831","name":"금속류 해체, 선별 및 원료"},{"code":"3832","name":"비금속류 해체, 선별 및 원료"},{"code":"3900","name":"환경 정화 및 복원업"},{"code":"4111","name":"주거용 건물 건설업"},{"code":"4112","name":"비주거용 건물 건설업"},{"code":"4121","name":"지반조성 건설업"},{"code":"4122","name":"토목시설물 건설업"},{"code":"4211","name":"건물 및 구축물 해체 공사업"},{"code":"4212","name":"기반조성 관련 전문공사업"},{"code":"4213","name":"철골, 철근 및 콘크리트 공사업"},{"code":"4219","name":"기타 시설물 축조 관련"},{"code":"4220","name":"건물설비 설치 공사업"},{"code":"4231","name":"전기 공사업"},{"code":"4232","name":"통신 공사업"},{"code":"4241","name":"도장, 도배 및 내장 공사업"},{"code":"4242","name":"유리 및 창호 공사업"},{"code":"4249","name":"기타 건축마무리 공사업"},{"code":"4250","name":"시설물 유지관리 공사업"},{"code":"4260","name":"건설장비 운영업"},{"code":"4511","name":"자동차 신품 판매업"},{"code":"4512","name":"중고 자동차 판매업"},{"code":"4521","name":"자동차 신품 부품 및 내장품"},{"code":"4522","name":"자동차 중고 부품 및 내장품"},{"code":"4530","name":"모터사이클 및 부품 판매업"},{"code":"4610","name":"상품 중개업"},{"code":"4620","name":"산업용 농"},{"code":"4631","name":"신선식품 및 단순 가공식품"},{"code":"4632","name":"가공식품 도매업"},{"code":"4633","name":"음료 및 담배 도매업"},{"code":"4641","name":"생활용 섬유제품, 의복, 의복 액세"},{"code":"4642","name":"신발 도매업"},{"code":"4643","name":"생활용 가구, 조명기구 및"},{"code":"4644","name":"의약품, 의료용품 및 화장품"},{"code":"4645","name":"생활용 포장"},{"code":"4646","name":"음반 및 비디오물, 악기, 오락 및"},{"code":"4649","name":"가방, 시계, 안경 및 기타"},{"code":"4651","name":"컴퓨터 및 주변장치, 소프트웨어"},{"code":"4652","name":"가전제품, 통신장비 및 부품"},{"code":"4653","name":"산업용 기계 및 장비 도매업"},{"code":"4659","name":"기타 기계 및 장비 도매업"},{"code":"4661","name":"일반 건축자재 도매업"},{"code":"4662","name":"화학제품 도매업"},{"code":"4669","name":"기타 건축자재 도매업"},{"code":"4671","name":"연료, 연료용 광물 및 관련제품"},{"code":"4672","name":"금속 및 금속광물 도매업"},{"code":"4673","name":"화학물질 및 화학제품 도매업"},{"code":"4674","name":"방직용 섬유, 실 및 직물 도매업"},{"code":"4675","name":"종이 원지, 판지, 종이상자 도매업"},{"code":"4679","name":"재생용 재료 및 기타 상품 전문"},{"code":"4680","name":"상품 종합 도매업"},{"code":"4711","name":"대형 종합 소매업"},{"code":"4712","name":"음식료품 및 담배 소매업"},{"code":"4713","name":"면세점"},{"code":"4719","name":"그 외 기타 종합 소매업"},{"code":"4721","name":"신선식품 및 단순 가공식품"},{"code":"4722","name":"가공식품 소매업"},{"code":"4723","name":"음료 및 담배 소매업"},{"code":"4731","name":"컴퓨터 및 주변장치, 소프트웨어"},{"code":"4732","name":"가전제품 소매업"},{"code":"4741","name":"의복 소매업"},{"code":"4742","name":"섬유, 직물 및 의복액세서리"},{"code":"4743","name":"신발 소매업"},{"code":"4744","name":"가방 및 기타 가죽제품 소매업"},{"code":"4751","name":"철물, 공구, 창호 및 건설자재"},{"code":"4752","name":"가구 소매업"},{"code":"4759","name":"그 외 기타 가정용품 소매업"},{"code":"4761","name":"서적 및 문구용품 소매업"},{"code":"4762","name":"음반 및 비디오물 소매업"},{"code":"4763","name":"운동용품 및 자전거 소매업"},{"code":"4764","name":"게임용구, 인형 및 장난감 소매업"},{"code":"4771","name":"운송장비용 연료 소매업"},{"code":"4772","name":"가정용 연료 소매업"},{"code":"4781","name":"의약품, 의료용 기구, 화장품 및"},{"code":"4782","name":"사무용 기기, 안경, 사진장비 및"},{"code":"4783","name":"시계 및 귀금속 소매업"},{"code":"4784","name":"예술품, 기념품 및 장식용품"},{"code":"4785","name":"그 외 기타 상품 전문 소매업"},{"code":"4786","name":"중고 상품 소매업"},{"code":"4791","name":"통신 판매업"},{"code":"4792","name":"노점 및 유사이동 소매업"},{"code":"4799","name":"기타 무점포 소매업"},{"code":"4910","name":"철도 운송업"},{"code":"4921","name":"도시 정기 육상 여객 운송업"},{"code":"4922","name":"시외버스 운송업"},{"code":"4923","name":"부정기 육상 여객 운송업"},{"code":"4930","name":"도로 화물 운송업"},{"code":"4940","name":"소화물 전문 운송업"},{"code":"4950","name":"파이프라인 운송업"},{"code":"5011","name":"외항 운송업"},{"code":"5012","name":"내항 운송업"},{"code":"5013","name":"기타 해상 운송업"},{"code":"5020","name":"내륙 수상 및 항만 내 운송업"},{"code":"5110","name":"항공 여객 운송업"},{"code":"5120","name":"항공 화물 운송업"},{"code":"5210","name":"보관 및 창고업"},{"code":"5291","name":"육상 운송지원 서비스업"},{"code":"5292","name":"수상 운송지원 서비스업"},{"code":"5293","name":"항공 운송지원 서비스업"},{"code":"5294","name":"화물 취급업"},{"code":"5299","name":"그 외 기타 운송관련 서비스업"},{"code":"5510","name":"일반 및 생활 숙박시설 운영업"},{"code":"5590","name":"기타 숙박업"},{"code":"5611","name":"한식 음식점업"},{"code":"5612","name":"외국식 음식점업"},{"code":"5613","name":"기관 구내식당업"},{"code":"5614","name":"출장 및 이동 음식점업"},{"code":"5615","name":"제과점업"},{"code":"5616","name":"피자, 햄버거 및 치킨 전문점"},{"code":"5619","name":"김밥 및 기타 간이 음식점업"},{"code":"5621","name":"주점업"},{"code":"5622","name":"비알코올 음료점업"},{"code":"5811","name":"서적 출판업"},{"code":"5812","name":"신문, 잡지 및 정기간행물 출판업"},{"code":"5819","name":"기타 인쇄물 출판업"},{"code":"5821","name":"게임 소프트웨어 개발 및 공급업"},{"code":"5822","name":"시스템"},{"code":"5911","name":"영화, 비디오물 및 방송프로그램"},{"code":"5912","name":"영화, 비디오물 및 방송프로그램"},{"code":"5913","name":"영화, 비디오물 및 방송프로그램"},{"code":"5914","name":"영화 및 비디오물 상영업"},{"code":"5920","name":"오디오물 출판 및 원판 녹음업"},{"code":"6010","name":"라디오 방송업"},{"code":"6021","name":"지상파 방송업"},{"code":"6022","name":"유선, 위성 및 기타 방송업"},{"code":"6031","name":"영상물 제공 서비스업"},{"code":"6032","name":"오디오물 제공 서비스업"},{"code":"6110","name":"공영 우편업"},{"code":"6121","name":"유선 통신업"},{"code":"6122","name":"무선 및 위성 통신업"},{"code":"6129","name":"기타 전기 통신업"},{"code":"6201","name":"컴퓨터 프로그래밍 서비스업"},{"code":"6202","name":"컴퓨터시스템 통합 자문, 구축 및"},{"code":"6209","name":"기타 정보기술 및 컴퓨터운영"},{"code":"6311","name":"자료처리, 호스팅 및 관련"},{"code":"6312","name":"포털 및 기타 인터넷 정보매개"},{"code":"6391","name":"뉴스 제공업"},{"code":"6399","name":"그 외 기타 정보 서비스업"},{"code":"6411","name":"중앙은행"},{"code":"6412","name":"일반은행"},{"code":"6413","name":"신용조합 및 저축기관"},{"code":"6420","name":"신탁업 및 집합투자업"},{"code":"6491","name":"여신금융업"},{"code":"6499","name":"그 외 기타 금융업"},{"code":"6511","name":"생명 보험업"},{"code":"6512","name":"손해 및 보증 보험업"},{"code":"6513","name":"손해 보험업"},{"code":"6520","name":"재 보험업"},{"code":"6530","name":"공제업"},{"code":"6611","name":"금융시장 관리업"},{"code":"6612","name":"증권 및 선물 중개업"},{"code":"6619","name":"기타 금융 지원 서비스업"},{"code":"6620","name":"보험 및 연금관련 서비스업"},{"code":"6811","name":"부동산 임대업"},{"code":"6812","name":"부동산 개발 및 공급업"},{"code":"6821","name":"부동산 관리업"},{"code":"6822","name":"부동산 중개, 자문 및 감정평가업"},{"code":"7011","name":"자연과학 연구개발업"},{"code":"7012","name":"공학 연구개발업"},{"code":"7013","name":"자연과학 및 공학 융합"},{"code":"7020","name":"인문 및 사회과학 연구개발업"},{"code":"7110","name":"석회석 및 점토 광업"},{"code":"7120","name":"회계 및 세무관련 서비스업"},{"code":"7131","name":"광고 대행업"},{"code":"7139","name":"기타 광고업"},{"code":"7140","name":"시장조사 및 여론조사업"},{"code":"7151","name":"회사 본부"},{"code":"7153","name":"경영 컨설팅 및 공공 관계"},{"code":"7160","name":"기타 전문 서비스업"},{"code":"7211","name":"건축 및 조경 설계 서비스업"},{"code":"7212","name":"엔지니어링 서비스업"},{"code":"7291","name":"기술 시험, 검사 및 분석업"},{"code":"7292","name":"측량, 지질조사 및 지도제작업"},{"code":"7310","name":"수의업"},{"code":"7320","name":"전문 디자인업"},{"code":"7330","name":"사진 촬영 및 처리업"},{"code":"7390","name":"그 외 기타 전문, 과학 및 기술"},{"code":"7410","name":"사업시설 유지"},{"code":"7421","name":"건물 및 산업설비 청소업"},{"code":"7422","name":"소독, 구충 및 방제 서비스업"},{"code":"7430","name":"조경 관리 및 유지 서비스업"},{"code":"7511","name":"고용 알선업"},{"code":"7512","name":"인력 공급업"},{"code":"7521","name":"여행사업"},{"code":"7529","name":"기타 여행보조 및 예약 서비스업"},{"code":"7531","name":"경비 및 경호 서비스업"},{"code":"7532","name":"보안시스템 서비스업"},{"code":"7533","name":"탐정 및 조사 서비스업"},{"code":"7591","name":"사무지원 서비스업"},{"code":"7599","name":"그 외 기타 사업지원 서비스업"},{"code":"7611","name":"자동차 임대업"},{"code":"7619","name":"기타 운송장비 임대업"},{"code":"7621","name":"스포츠 및 레크리에이션 용품"},{"code":"7622","name":"음반 및 비디오물 임대업"},{"code":"7629","name":"기타 개인 및 가정용품 임대업"},{"code":"7631","name":"건설 및 토목공사용 기계"},{"code":"7632","name":"컴퓨터 및 사무용 기계"},{"code":"7639","name":"기타 산업용 기계 및 장비 임대업"},{"code":"7640","name":"무형재산권 임대업"},{"code":"8411","name":"일반 공공 행정"},{"code":"8412","name":"정부기관 일반 보조 행정"},{"code":"8421","name":"사회서비스 관리 행정"},{"code":"8422","name":"노동 및 산업진흥 행정"},{"code":"8431","name":"외무 행정"},{"code":"8432","name":"국방 행정"},{"code":"8440","name":"사법 및 공공질서 행정"},{"code":"8450","name":"사회보장 행정"},{"code":"8461","name":"사회보장 보험업"},{"code":"8462","name":"연금업"},{"code":"8511","name":"유아 교육기관"},{"code":"8512","name":"초등학교"},{"code":"8521","name":"일반 중등 교육기관"},{"code":"8522","name":"특성화 고등학교"},{"code":"8530","name":"고등 교육기관"},{"code":"8541","name":"특수학교"},{"code":"8542","name":"외국인 학교"},{"code":"8543","name":"대안학교"},{"code":"8550","name":"일반 교습 학원"},{"code":"8561","name":"스포츠 및 레크리에이션 교육기관"},{"code":"8562","name":"예술학원"},{"code":"8563","name":"외국어학원 및 기타 교습학원"},{"code":"8564","name":"사회교육시설"},{"code":"8565","name":"직원훈련기관"},{"code":"8566","name":"기술 및 직업훈련학원"},{"code":"8569","name":"그 외 기타 교육기관"},{"code":"8570","name":"교육지원 서비스업"},{"code":"8610","name":"병원"},{"code":"8620","name":"의원"},{"code":"8630","name":"공중 보건 의료업"},{"code":"8690","name":"기타 보건업"},{"code":"8711","name":"노인 거주 복지시설 운영업"},{"code":"8712","name":"심신장애인 거주 복지시설 운영업"},{"code":"8713","name":"기타 거주 복지시설 운영업"},{"code":"8721","name":"보육시설 운영업"},{"code":"8729","name":"기타 비거주 복지 서비스업"},{"code":"9011","name":"공연시설 운영업"},{"code":"9012","name":"공연단체"},{"code":"9013","name":"자영 예술가"},{"code":"9019","name":"기타 창작 및 예술관련 서비스업"},{"code":"9021","name":"도서관, 기록보존소 및 독서실"},{"code":"9022","name":"박물관 및 사적지 관리 운영업"},{"code":"9023","name":"식물원, 동물원 및 자연공원"},{"code":"9029","name":"기타 유사 여가관련 서비스업"},{"code":"9111","name":"경기장 운영업"},{"code":"9112","name":"골프장 및 스키장 운영업"},{"code":"9113","name":"기타 스포츠시설 운영업"},{"code":"9119","name":"기타 스포츠 서비스업"},{"code":"9121","name":"유원지 및 테마파크 운영업"},{"code":"9122","name":"오락장 운영업"},{"code":"9123","name":"수상오락 서비스업"},{"code":"9124","name":"사행시설 관리 및 운영업"},{"code":"9129","name":"그 외 기타 오락관련 서비스업"},{"code":"9411","name":"산업 단체"},{"code":"9412","name":"전문가 단체"},{"code":"9420","name":"노동조합"},{"code":"9491","name":"종교 단체"},{"code":"9492","name":"정치 단체"},{"code":"9493","name":"시민운동 단체"},{"code":"9499","name":"그 외 기타 협회 및 단체"},{"code":"9511","name":"컴퓨터 및 주변 기기 수리업"},{"code":"9512","name":"통신장비 수리업"},{"code":"9521","name":"자동차 수리 및 세차업"},{"code":"9522","name":"모터사이클 수리업"},{"code":"9531","name":"가전제품 수리업"},{"code":"9539","name":"기타 개인 및 가정용품 수리업"},{"code":"9611","name":"이용 및 미용업"},{"code":"9612","name":"욕탕, 마사지 및 기타 신체관리"},{"code":"9691","name":"세탁업"},{"code":"9692","name":"장례식장 및 관련 서비스업"},{"code":"9699","name":"그 외 기타 분류 안된 개인"},{"code":"9700","name":"가구 내 고용활동"},{"code":"9810","name":"자가 소비를 위한 가사 생산 활동"},{"code":"9820","name":"자가 소비를 위한 가사 서비스"},{"code":"9900","name":"국제 및 외국기관"},{"code":"01110","name":"곡물 및 기타 식량작물 재배업"},{"code":"01121","name":"채소작물 재배업"},{"code":"01122","name":"화훼작물 재배업"},{"code":"01123","name":"종자 및 묘목 생산업"},{"code":"01131","name":"과실작물 재배업"},{"code":"01132","name":"음료용 및 향신용 작물 재배업"},{"code":"01140","name":"기타 작물 재배업"},{"code":"01151","name":"콩나물 재배업"},{"code":"01159","name":"기타 시설작물 재배업"},{"code":"01211","name":"젖소 사육업"},{"code":"01212","name":"육우 사육업"},{"code":"01220","name":"양돈업"},{"code":"01231","name":"양계업"},{"code":"01239","name":"기타 가금류 및 조류 사육업"},{"code":"01291","name":"말 및 양 사육업"},{"code":"01299","name":"그 외 기타 축산업"},{"code":"01300","name":"작물재배 및 축산 복합농업"},{"code":"01411","name":"작물재배 지원 서비스업"},{"code":"01412","name":"농산물 건조, 선별 및 기타 수확"},{"code":"01420","name":"축산 관련 서비스업"},{"code":"01500","name":"수렵 및 관련 서비스업"},{"code":"02011","name":"임업용 종묘 생산업"},{"code":"02012","name":"육림업"},{"code":"02020","name":"벌목업"},{"code":"02030","name":"임산물 채취업"},{"code":"02040","name":"임업 관련 서비스업"},{"code":"03111","name":"원양 어업"},{"code":"03112","name":"연근해 어업"},{"code":"03120","name":"내수면 어업"},{"code":"03211","name":"해수면 양식 어업"},{"code":"03212","name":"내수면 양식 어업"},{"code":"03213","name":"수산물 부화 및 수산종자 생산업"},{"code":"03220","name":"어업 관련 서비스업"},{"code":"05100","name":"석탄 광업"},{"code":"05200","name":"원유 및 천연가스 채굴업"},{"code":"06100","name":"철 광업"},{"code":"06200","name":"비철금속 광업"},{"code":"07110","name":"석회석 및 점토 광업"},{"code":"07121","name":"건설용 석재 채굴 및 쇄석 생산업"},{"code":"07122","name":"모래 및 자갈 채취업"},{"code":"07210","name":"화학용 및 비료원료용 광물 광업"},{"code":"07220","name":"천일염 생산 및 암염 채취업"},{"code":"07290","name":"그 외 기타 비금속광물 광업"},{"code":"08000","name":"광업 지원 서비스업"},{"code":"10111","name":"육류 도축업(가금류 제외)"},{"code":"10112","name":"가금류 도축업"},{"code":"10121","name":"가금류 가공 및 저장 처리업"},{"code":"10122","name":"육류 포장육 및 냉동육 가공업 (가금류 제외)"},{"code":"10129","name":"육류 기타 가공 및 저장처리업 (가금류 제외)"},{"code":"10211","name":"수산동물 훈제, 조리 및 유사 조제식품 제조업"},{"code":"10212","name":"수산동물 건조 및 염장품 제조업"},{"code":"10213","name":"수산동물 냉동품 제조업"},{"code":"10219","name":"기타 수산동물 가공 및 저장 처리업"},{"code":"10220","name":"수산식물 가공 및 저장 처리업"},{"code":"10301","name":"김치류 제조업"},{"code":"10302","name":"과실 및 그 외 채소 절임식품 제조업"},{"code":"10309","name":"기타 과실ㆍ채소 가공 및 저장 처리업"},{"code":"10411","name":"동물성 유지 제조업"},{"code":"10412","name":"식물성 유지 제조업"},{"code":"10413","name":"식용 정제유 및 가공유 제조업"},{"code":"10421","name":"액상시유 및 기타 낙농제품 제조업"},{"code":"10422","name":"아이스크림 및 기타 식용빙과류 제조업"},{"code":"10511","name":"곡물 도정업"},{"code":"10512","name":"곡물 제분업"},{"code":"10513","name":"곡물 혼합분말 및 반죽 제조업"},{"code":"10519","name":"기타 곡물 가공품 제조업"},{"code":"10520","name":"전분제품 및 당류 제조업"},{"code":"10601","name":"떡류 제조업"},{"code":"10602","name":"빵류 제조업"},{"code":"10603","name":"과자류 및 코코아 제품 제조업"},{"code":"10701","name":"도시락류 제조업"},{"code":"10709","name":"기타 식사용 가공처리 조리식품 제조업"},{"code":"10801","name":"배합 사료 제조업"},{"code":"10802","name":"단미 사료 및 기타 사료 제조업"},{"code":"10810","name":"설탕 제조업"},{"code":"10820","name":"면류, 마카로니 및 유사식품 제조업"},{"code":"10831","name":"식초, 발효 및 화학 조미료 제조업"},{"code":"10832","name":"천연 및 혼합조제 조미료 제조업"},{"code":"10833","name":"장류 제조업"},{"code":"10839","name":"기타 식품 첨가물 제조업"},{"code":"10891","name":"커피 가공업"},{"code":"10892","name":"차류 가공업"},{"code":"10893","name":"수프 및 균질화식품 제조업"},{"code":"10894","name":"두부 및 유사식품 제조업"},{"code":"10895","name":"인삼식품 제조업"},{"code":"10896","name":"건강보조용 액화식품 제조업"},{"code":"10897","name":"건강기능식품 제조업"},{"code":"10899","name":"그 외 기타 식료품 제조업"},{"code":"10901","name":"반려동물용 사료 제조업"},{"code":"10902","name":"배합 사료 제조업"},{"code":"10903","name":"단미사료 및 기타 사료 제조업"},{"code":"11111","name":"탁주 및 약주 제조업"},{"code":"11112","name":"맥아 및 맥주 제조업"},{"code":"11119","name":"기타 발효주 제조업"},{"code":"11121","name":"주정 제조업"},{"code":"11122","name":"소주 제조업"},{"code":"11129","name":"기타 증류주 및 합성주 제조업"},{"code":"11201","name":"얼음 제조업"},{"code":"11202","name":"생수 생산업"},{"code":"11209","name":"기타 비알코올 음료 제조업"},{"code":"12000","name":"담배제품 제조업"},{"code":"13101","name":"면 방적업"},{"code":"13102","name":"모 방적업"},{"code":"13103","name":"화학섬유 방적업"},{"code":"13104","name":"연사 및 가공사 제조업"},{"code":"13109","name":"기타 방적업"},{"code":"13211","name":"면직물 직조업"},{"code":"13212","name":"모직물 직조업"},{"code":"13213","name":"화학섬유직물 직조업"},{"code":"13219","name":"특수 직물 및 기타 직물 직조업"},{"code":"13221","name":"침구 및 관련제품 제조업"},{"code":"13222","name":"자수제품 및 자수용재료 제조업"},{"code":"13223","name":"커튼 및 유사제품 제조업"},{"code":"13224","name":"천막, 텐트 및 유사 제품 제조업"},{"code":"13225","name":"직물포대 제조업"},{"code":"13229","name":"기타 직물제품 제조업"},{"code":"13300","name":"편조원단 제조업"},{"code":"13401","name":"솜 및 실 염색가공업"},{"code":"13402","name":"직물, 편조원단 및 의복류 염색 가공업"},{"code":"13403","name":"날염 가공업"},{"code":"13409","name":"섬유제품 기타 정리 및 마무리 가공업"},{"code":"13910","name":"카펫, 마루덮개 및 유사제품 제조업"},{"code":"13921","name":"끈 및 로프 제조업"},{"code":"13922","name":"어망 및 기타 끈 가공품 제조업"},{"code":"13991","name":"세폭직물 제조업"},{"code":"13992","name":"부직포 및 펠트 제조업"},{"code":"13993","name":"특수사 및 코드직물 제조업"},{"code":"13994","name":"표면처리 및 적층 직물 제조업"},{"code":"13999","name":"그 외 기타 분류 안된 섬유제품 제조업"},{"code":"14111","name":"남자용 겉옷 제조업"},{"code":"14112","name":"여자용 겉옷 제조업"},{"code":"14120","name":"속옷 및 잠옷 제조업"},{"code":"14130","name":"한복 제조업"},{"code":"14191","name":"셔츠 및 블라우스 제조업"},{"code":"14192","name":"근무복, 작업복 및 유사의복 제조업"},{"code":"14193","name":"가죽의복 제조업"},{"code":"14194","name":"유아용 의복 제조업"},{"code":"14199","name":"그 외 기타 봉제의복 제조업"},{"code":"14200","name":"모피제품 제조업"},{"code":"14300","name":"편조의복 제조업"},{"code":"14411","name":"스타킹 및 기타 양말 제조업"},{"code":"14419","name":"기타 편조의복 액세서리 제조업"},{"code":"14491","name":"모자 제조업"},{"code":"14499","name":"그 외 기타 의복액세서리 제조업"},{"code":"15110","name":"모피 및 가죽 제조업"},{"code":"15121","name":"핸드백 및 지갑 제조업"},{"code":"15129","name":"가방 및 기타 보호용 케이스 제조업"},{"code":"15190","name":"기타 가죽제품 제조업"},{"code":"15211","name":"구두류 제조업"},{"code":"15219","name":"기타 신발 제조업"},{"code":"15220","name":"신발 부분품 제조업"},{"code":"16101","name":"일반 제재업"},{"code":"16102","name":"표면 가공 목재 및 특정 목적용 제재목 제조업"},{"code":"16103","name":"목재 보존, 방부처리, 도장 및 유사 처리업"},{"code":"16211","name":"박판, 합판 및 유사 적층판 제조업"},{"code":"16212","name":"강화 및 재생 목재 제조업"},{"code":"16221","name":"목재문 및 관련제품 제조업"},{"code":"16229","name":"기타 건축용 나무제품 제조업"},{"code":"16231","name":"목재 깔판류 및 기타 적재판 제조업"},{"code":"16232","name":"목재 포장용 상자, 드럼 및 유사용기 제조업"},{"code":"16291","name":"목재 도구 및 주방용 나무제품 제조업"},{"code":"16292","name":"장식용 목제품 제조업"},{"code":"16299","name":"그 외 기타 나무제품 제조업"},{"code":"16300","name":"코르크 및 조물제품 제조업"},{"code":"17101","name":"펄프 제조업"},{"code":"17102","name":"신문용지 제조업"},{"code":"17103","name":"인쇄용 및 필기용 원지 제조업"},{"code":"17104","name":"골판지 원지 제조업"},{"code":"17105","name":"크라프트지 및 기타 상자용 판지 제조업"},{"code":"17106","name":"위생용 원지 제조업"},{"code":"17109","name":"기타 종이 및 판지 제조업"},{"code":"17123","name":"크라프트지"},{"code":"17211","name":"골판지 제조업"},{"code":"17212","name":"골판지 상자 및 가공제품 제조업"},{"code":"17221","name":"종이 포대 및 가방 제조업"},{"code":"17222","name":"판지 상자 및 용기 제조업"},{"code":"17223","name":"식품 위생용 종이 상자 및 용기 제조업"},{"code":"17229","name":"기타 종이 상자 및 용기 제조업"},{"code":"17901","name":"문구용 종이제품 제조업"},{"code":"17902","name":"위생용 종이제품 제조업"},{"code":"17903","name":"벽지 및 장판지 제조업"},{"code":"17904","name":"적층, 합성 및 특수 표면처리 종이 제조업"},{"code":"17909","name":"그 외 기타 종이 및 판지 제품 제조업"},{"code":"18111","name":"경 인쇄업"},{"code":"18112","name":"스크린 인쇄업"},{"code":"18113","name":"오프셋 인쇄업"},{"code":"18119","name":"기타 인쇄업"},{"code":"18121","name":"제판 및 조판업"},{"code":"18122","name":"제책업"},{"code":"18129","name":"기타 인쇄관련 산업"},{"code":"18200","name":"기록매체 복제업"},{"code":"19100","name":"코크스 및 연탄 제조업"},{"code":"19101","name":"코크스 및 관련제품 제조업"},{"code":"19102","name":"연탄 및 기타 석탄 가공품 제조업"},{"code":"19210","name":"원유 정제처리업"},{"code":"19221","name":"윤활유 및 그리스 제조업"},{"code":"19229","name":"기타 석유정제물 재처리업"},{"code":"20111","name":"석유화학계 기초 화학물질 제조업"},{"code":"20112","name":"바이오매스계 기초 화학물질 제조업"},{"code":"20119","name":"기타 기초 유기화학 물질 제조업"},{"code":"20121","name":"수소 제조업"},{"code":"20122","name":"산소, 질소 및 기타 산업용 가스 제조업"},{"code":"20129","name":"기타 기초 무기 화학물질 제조업"},{"code":"20131","name":"무기안료용 금속 산화물 및 관련 제품 제조업"},{"code":"20132","name":"염료, 조제 무기안료, 유연제 및 기타 착색제 제조업"},{"code":"20201","name":"합성고무 제조업"},{"code":"20202","name":"합성수지 및 기타 플라스틱 물질 제조업"},{"code":"20203","name":"혼성 및 재생 플라스틱 소재 물질 제조업"},{"code":"20311","name":"질소화합물, 질소, 인산 및 칼리질 화학비료 제조업"},{"code":"20312","name":"복합비료 및 기타 화학비료 제조업"},{"code":"20313","name":"유기질 비료 및 상토 제조업"},{"code":"20321","name":"화학 살균ㆍ살충제 및 농업용 약제 제조업"},{"code":"20322","name":"생물 살균ㆍ살충제 및 식물보호제 제조업"},{"code":"20411","name":"일반용 도료 및 관련제품 제조업"},{"code":"20412","name":"요업용 도포제 및 관련제품 제조업"},{"code":"20413","name":"인쇄잉크 및 회화용 물감 제조업"},{"code":"20421","name":"계면활성제 제조업"},{"code":"20422","name":"치약, 비누 및 기타 세제 제조업"},{"code":"20423","name":"화장품 제조업"},{"code":"20424","name":"표면광택제 및 실내가향제 제조업"},{"code":"20491","name":"감광재료 및 관련 화학제품 제조업"},{"code":"20492","name":"가공 및 정제염 제조업"},{"code":"20493","name":"접착제 및 젤라틴 제조업"},{"code":"20494","name":"화약 및 불꽃제품 제조업"},{"code":"20495","name":"바이오 연료 및 혼합물 제조업"},{"code":"20499","name":"그 외 기타 분류 안된 화학제품 제조업"},{"code":"20501","name":"합성섬유 제조업"},{"code":"20502","name":"재생섬유 제조업"},{"code":"21100","name":"기초 의약 물질 제조업"},{"code":"21101","name":"의약용"},{"code":"21102","name":"생물학적 제제 제조업"},{"code":"21210","name":"완제 의약품 제조업"},{"code":"21211","name":"생물 의약품 제조업"},{"code":"21212","name":"합성의약품 및 기타 완제 의약품 제조업"},{"code":"21220","name":"한의약품 제조업"},{"code":"21230","name":"동물용 의약품 제조업"},{"code":"21300","name":"의료용품"},{"code":"21301","name":"체외 진단 시약 제조업"},{"code":"21309","name":"그 외 기타 의료용품 및 의약 관련제품 제조업"},{"code":"22110","name":"고무 타이어 및 튜브 제조업"},{"code":"22111","name":"타이어 및 튜브 제조업"},{"code":"22112","name":"타이어 재생업"},{"code":"22191","name":"고무패킹류 제조업"},{"code":"22192","name":"산업용 그 외 비경화 고무제품 제조업"},{"code":"22193","name":"고무 의류 및 기타 위생용 비경화 고무제품 제조업"},{"code":"22199","name":"그 외 기타 고무제품 제조업"},{"code":"22211","name":"플라스틱 선, 봉, 관 및 호스 제조업"},{"code":"22212","name":"플라스틱 필름 제조업"},{"code":"22213","name":"플라스틱 시트 및 판 제조업"},{"code":"22214","name":"플라스틱 합성피혁 제조업"},{"code":"22221","name":"벽 및 바닥 피복용 플라스틱제품 제조업"},{"code":"22222","name":"설치용 및 위생용 플라스틱제품 제조업"},{"code":"22223","name":"플라스틱 창호 제조업"},{"code":"22229","name":"기타 건축용 플라스틱 조립제품 제조업"},{"code":"22231","name":"플라스틱 포대, 봉투 및 유사제품 제조업"},{"code":"22232","name":"포장용 플라스틱 성형용기 제조업"},{"code":"22241","name":"운송장비 조립용 플라스틱제품 제조업"},{"code":"22249","name":"기타 기계ㆍ장비 조립용 플라스틱 제품 제조업"},{"code":"22251","name":"폴리스티렌 발포 성형제품 제조업"},{"code":"22259","name":"기타 플라스틱 발포 성형제품 제조업"},{"code":"22291","name":"플라스틱 접착처리 제품 제조업"},{"code":"22292","name":"플라스틱 적층, 도포 및 기타 표면처리 제품 제조업"},{"code":"22299","name":"그 외 기타 플라스틱 제품 제조업"},{"code":"23111","name":"판유리 제조업"},{"code":"23112","name":"안전유리 제조업"},{"code":"23119","name":"기타 판유리 가공품 제조업"},{"code":"23121","name":"1차 유리제품, 유리섬유 및 광학용 유리 제조업"},{"code":"23122","name":"디스플레이 장치용 유리 제조업"},{"code":"23129","name":"기타 산업용 유리제품 제조업"},{"code":"23191","name":"가정용 유리제품 제조업"},{"code":"23192","name":"포장용 유리용기 제조업"},{"code":"23199","name":"그 외 기타 유리제품 제조업"},{"code":"23211","name":"정형 내화 요업제품 제조업"},{"code":"23212","name":"부정형 내화 요업제품 제조업"},{"code":"23221","name":"가정용 및 장식용 도자기 제조업"},{"code":"23222","name":"위생용 및 산업용 도자기 제조업"},{"code":"23229","name":"기타 일반 도자기 제조업"},{"code":"23231","name":"점토 벽돌, 블록 및 유사 비내화 요업제품 제조업"},{"code":"23232","name":"타일 및 유사 비내화 요업제품 제조업"},{"code":"23239","name":"기타 건축용 비내화 요업제품 제조업"},{"code":"23311","name":"시멘트 제조업"},{"code":"23312","name":"석회 및 플라스터 제조업"},{"code":"23321","name":"비내화 모르타르 제조업"},{"code":"23322","name":"레미콘 제조업"},{"code":"23323","name":"플라스터 혼합제품 제조업"},{"code":"23324","name":"콘크리트 타일, 기와, 벽돌 및 블록 제조업"},{"code":"23325","name":"콘크리트 관 및 기타 구조용 콘크리트제품 제조업"},{"code":"23326","name":"인조대리석 제품 제조업"},{"code":"23329","name":"그 외 기타 콘크리트 제품 및 유사제품 제조업"},{"code":"23911","name":"건설용 석제품 제조업"},{"code":"23919","name":"기타 석제품 제조업"},{"code":"23991","name":"아스팔트 콘크리트 및 혼합제품 제조업"},{"code":"23992","name":"연마재 제조업"},{"code":"23993","name":"비금속광물 분쇄물 생산업"},{"code":"23994","name":"암면 및 유사제품 제조업"},{"code":"23995","name":"탄소섬유 제조업"},{"code":"23999","name":"그 외 기타 분류 안된 비금속 광물제품 제조업"},{"code":"24111","name":"제철업"},{"code":"24112","name":"제강업"},{"code":"24113","name":"합금철 제조업"},{"code":"24119","name":"기타 제철 및 제강업"},{"code":"24121","name":"열간 압연 및 압출 제품 제조업"},{"code":"24122","name":"냉간 압연 및 압출 제품 제조업"},{"code":"24123","name":"철강선 제조업"},{"code":"24131","name":"주철관 제조업"},{"code":"24132","name":"강관 제조업"},{"code":"24133","name":"강관 가공품 및 관 연결구류 제조업"},{"code":"24191","name":"도금, 착색 및 기타 표면처리강재 제조업"},{"code":"24199","name":"그 외 기타 1차 철강 제조업"},{"code":"24211","name":"동 제련, 정련 및 합금 제조업"},{"code":"24212","name":"알루미늄 제련, 정련 및 합금 제조업"},{"code":"24213","name":"연 및 아연 제련, 정련 및 합금 제조업"},{"code":"24219","name":"기타 비철금속 제련, 정련 및 합금 제조업"},{"code":"24221","name":"동 압연, 압출 및 연신제품 제조업"},{"code":"24222","name":"알루미늄 압연, 압출 및 연신제품 제조업"},{"code":"24229","name":"기타 비철금속 압연, 압출 및 연신 제품 제조업"},{"code":"24290","name":"기타 1차 비철금속 제조업"},{"code":"24311","name":"선철주물 주조업"},{"code":"24312","name":"강주물 주조업"},{"code":"24321","name":"알루미늄주물 주조업"},{"code":"24322","name":"동주물 주조업"},{"code":"24329","name":"기타 비철금속 주조업"},{"code":"25111","name":"금속 문, 창, 셔터 및 관련제품 제조업"},{"code":"25112","name":"구조용 금속 판제품 및 공작물 제조업"},{"code":"25113","name":"육상 금속 골조 구조재 제조업"},{"code":"25114","name":"수상 금속 골조 구조재 제조업"},{"code":"25119","name":"기타 구조용 금속제품 제조업"},{"code":"25121","name":"산업용 난방보일러 및 방열기 제조업"},{"code":"25122","name":"금속탱크 및 저장용기 제조업"},{"code":"25123","name":"압축 및 액화 가스용기 제조업"},{"code":"25130","name":"핵반응기 및 증기보일러 제조업"},{"code":"25200","name":"무기 및 총포탄 제조업"},{"code":"25911","name":"분말 야금제품 제조업"},{"code":"25912","name":"금속 단조제품 제조업"},{"code":"25913","name":"자동차용 금속 압형제품 제조업"},{"code":"25914","name":"그 외 금속 압형제품 제조업"},{"code":"25921","name":"금속 열처리업"},{"code":"25922","name":"도금업"},{"code":"25923","name":"도장 및 기타 피막처리업"},{"code":"25924","name":"절삭가공 및 유사처리업"},{"code":"25929","name":"그 외 기타 금속가공업"},{"code":"25931","name":"날붙이 제조업"},{"code":"25932","name":"일반철물 제조업"},{"code":"25933","name":"비동력식 수공구 제조업"},{"code":"25934","name":"톱 및 호환성 공구 제조업"},{"code":"25941","name":"볼트 및 너트류 제조업"},{"code":"25942","name":"그 외 금속파스너 및 나사제품 제조업"},{"code":"25943","name":"금속 스프링 제조업"},{"code":"25944","name":"금속선 가공제품 제조업"},{"code":"25991","name":"금속 캔 및 기타 포장용기 제조업"},{"code":"25992","name":"수동식 식품 가공기기 및 금속 주방용기 제조업"},{"code":"25993","name":"금속 위생용품 제조업"},{"code":"25994","name":"금속 표시판 제조업"},{"code":"25995","name":"피복 및 충전 용접봉 제조업"},{"code":"25999","name":"그 외 기타 분류 안된 금속 가공 제품 제조업"},{"code":"26111","name":"메모리용 전자집적회로 제조업"},{"code":"26112","name":"비메모리용 및 기타 전자집적회로 제조업"},{"code":"26121","name":"발광 다이오드 제조업"},{"code":"26129","name":"기타 반도체소자 제조업"},{"code":"26211","name":"액정 표시장치 제조업"},{"code":"26212","name":"유기발광 표시장치 제조업"},{"code":"26219","name":"기타 표시장치 제조업"},{"code":"26221","name":"인쇄회로기판용 적층판 제조업"},{"code":"26222","name":"경성 인쇄회로기판 제조업"},{"code":"26223","name":"연성 및 기타 인쇄회로기판 제조업"},{"code":"26224","name":"전자부품 실장기판 제조업"},{"code":"26291","name":"전자축전기 제조업"},{"code":"26292","name":"전자저항기 및 전자카드 제조업"},{"code":"26293","name":"전자코일, 변성기 및 기타 전자 유도자 제조업"},{"code":"26294","name":"전자감지장치 제조업"},{"code":"26299","name":"그 외 기타 전자부품 제조업"},{"code":"26310","name":"컴퓨터 제조업"},{"code":"26321","name":"기억장치 제조업"},{"code":"26322","name":"컴퓨터 모니터 제조업"},{"code":"26323","name":"컴퓨터 프린터 제조업"},{"code":"26329","name":"기타 주변기기 제조업"},{"code":"26410","name":"유선 통신장비 제조업"},{"code":"26421","name":"방송장비 제조업"},{"code":"26422","name":"이동전화기 제조업"},{"code":"26429","name":"기타 무선 통신장비 제조업"},{"code":"26511","name":"텔레비전 제조업"},{"code":"26519","name":"비디오 및 기타 영상기기 제조업"},{"code":"26521","name":"라디오, 녹음 및 재생 기기 제조업"},{"code":"26529","name":"기타 음향기기 제조업"},{"code":"26600","name":"마그네틱 및 광학 매체 제조업"},{"code":"27111","name":"방사선 장치 제조업"},{"code":"27112","name":"전기식 진단 및 요법 기기 제조업"},{"code":"27191","name":"치과용 기기 제조업"},{"code":"27192","name":"치과기공물 제조업"},{"code":"27193","name":"치과용 임플란트 제조업"},{"code":"27194","name":"정형 외과용 및 신체 보정용 기기 제조업"},{"code":"27195","name":"안경 및 안경렌즈 제조업"},{"code":"27196","name":"의료용 가구 제조업"},{"code":"27199","name":"그 외 기타 의료용 기기 제조업"},{"code":"27211","name":"레이더, 항행용 무선기기 및 측량기구 제조업"},{"code":"27212","name":"전자기 측정, 시험 및 분석기구 제조업"},{"code":"27213","name":"물질 검사, 측정 및 분석기구 제조업"},{"code":"27214","name":"속도계 및 적산계기 제조업"},{"code":"27215","name":"기기용 자동측정 및 제어장치 제조업"},{"code":"27216","name":"산업처리공정 제어장비 제조업"},{"code":"27219","name":"기타 측정, 시험, 항해, 제어 및 정밀기기 제조업"},{"code":"27220","name":"시계 및 시계부품 제조업"},{"code":"27301","name":"광학렌즈 및 광학요소 제조업"},{"code":"27302","name":"사진기"},{"code":"27309","name":"기타 광학기기 및 사진기 제조업"},{"code":"28111","name":"전동기 및 발전기 제조업"},{"code":"28112","name":"변압기 제조업"},{"code":"28113","name":"에너지 저장장치 제조업"},{"code":"28119","name":"기타 전기 변환장치 제조업"},{"code":"28121","name":"전기회로 개폐, 보호장치 제조업"},{"code":"28122","name":"전기회로 접속장치 제조업"},{"code":"28123","name":"배전반 및 전기 자동제어반 제조업"},{"code":"28201","name":"일차전지 제조업"},{"code":"28202","name":"운송장비용 이차전지 제조업"},{"code":"28209","name":"기타 이차전지 제조업"},{"code":"28301","name":"광섬유 케이블 제조업"},{"code":"28302","name":"기타 절연선 및 케이블 제조업"},{"code":"28303","name":"절연 코드세트 및 기타 도체 제조업"},{"code":"28410","name":"전구 및 램프 제조업"},{"code":"28421","name":"운송장비용 조명장치 제조업"},{"code":"28422","name":"일반용 전기 조명장치 제조업"},{"code":"28423","name":"전시 및 광고용 조명장치 제조업"},{"code":"28429","name":"기타 조명장치 제조업"},{"code":"28511","name":"주방용 전기기기 제조업"},{"code":"28512","name":"가정용 전기 난방기기 제조업"},{"code":"28519","name":"기타 가정용 전기기기 제조업"},{"code":"28520","name":"가정용 비전기식 조리 및 난방 기구 제조업"},{"code":"28901","name":"전기경보 및 신호장치 제조업"},{"code":"28902","name":"전기용 탄소제품 및 절연제품 제조업"},{"code":"28903","name":"교통 신호장치 제조업"},{"code":"28909","name":"그 외 기타 전기장비 제조업"},{"code":"29111","name":"내연기관 제조업"},{"code":"29119","name":"기타 기관 및 터빈 제조업"},{"code":"29120","name":"유압기기 제조업"},{"code":"29131","name":"액체 펌프 제조업"},{"code":"29132","name":"기체 펌프 및 압축기 제조업"},{"code":"29133","name":"탭, 밸브 및 유사장치 제조업"},{"code":"29141","name":"구름베어링 제조업"},{"code":"29142","name":"기어 및 동력전달장치 제조업"},{"code":"29150","name":"산업용 오븐, 노 및 노용 버너 제조업"},{"code":"29161","name":"산업용 트럭 및 적재기 제조업"},{"code":"29162","name":"승강기 제조업"},{"code":"29163","name":"컨베이어장치 제조업"},{"code":"29169","name":"기타 물품 취급장비 제조업"},{"code":"29171","name":"산업용 냉장 및 냉동 장비 제조업"},{"code":"29172","name":"가정용 및 산업용 공기 조화장치 제조업"},{"code":"29173","name":"운송장비용 공기 조화장치 제조업"},{"code":"29174","name":"산업용 송풍기 및 배기장치 제조업"},{"code":"29175","name":"기체 여과기 제조업"},{"code":"29176","name":"액체 여과기 제조업"},{"code":"29177","name":"증류기, 열교환기 및 가스발생기 제조업"},{"code":"29180","name":"사무용 기계 및 장비 제조업"},{"code":"29191","name":"용기 세척, 포장 및 충전기 제조업"},{"code":"29192","name":"분사기 및 소화기 제조업"},{"code":"29193","name":"동력식 수지공구 제조업"},{"code":"29199","name":"그 외 기타 일반목적용 기계 제조업"},{"code":"29210","name":"농업 및 임업용 기계 제조업"},{"code":"29221","name":"전자 응용 절삭기계 제조업"},{"code":"29222","name":"디지털 적층 성형기계 제조업"},{"code":"29223","name":"금속 절삭기계 제조업"},{"code":"29224","name":"금속 성형기계 제조업"},{"code":"29229","name":"기타 가공 공작기계 제조업"},{"code":"29230","name":"금속 주조 및 기타 야금용 기계 제조업"},{"code":"29241","name":"건설 및 채광용 기계장비 제조업"},{"code":"29242","name":"광물처리 및 취급장비 제조업"},{"code":"29250","name":"음·식료품 및 담배 가공기계 제조업"},{"code":"29261","name":"산업용 섬유 세척, 염색, 정리 및 가공 기계 제조업"},{"code":"29269","name":"기타 섬유, 의복 및 가죽 가공 기계 제조업"},{"code":"29271","name":"반도체 제조용 기계 제조업"},{"code":"29272","name":"디스플레이 제조용 기계 제조업"},{"code":"29280","name":"산업용 로봇 제조업"},{"code":"29291","name":"고무, 화학섬유 및 플라스틱 성형기 제조업"},{"code":"29292","name":"인쇄 및 제책용 기계 제조업"},{"code":"29293","name":"주형 및 금형 제조업"},{"code":"29299","name":"그 외 기타 특수목적용 기계 제조업"},{"code":"30110","name":"자동차용 엔진 제조업"},{"code":"30121","name":"내연기관 승용차 및 기타 여객용 자동차 제조업"},{"code":"30122","name":"전기 승용차 및 기타 여객용 전기 자동차 제조업"},{"code":"30123","name":"내연기관 화물자동차 및 특수목적용 자동차 제조업"},{"code":"30124","name":"전기 화물 자동차 및 특수 목적용 전기 자동차 제조업"},{"code":"30201","name":"차체 및 특장차 제조업"},{"code":"30202","name":"자동차 구조 및 장치 변경업"},{"code":"30203","name":"트레일러 및 세미트레일러 제조업"},{"code":"30310","name":"자동차 엔진용 신품 부품 제조업"},{"code":"30320","name":"자동차 차체용 신품 부품 제조업"},{"code":"30331","name":"자동차용 신품 동력전달장치 제조업"},{"code":"30332","name":"자동차용 신품 전기장치 제조업"},{"code":"30391","name":"자동차용 신품 조향장치 및 현가 장치 제조업"},{"code":"30392","name":"자동차용 신품 제동장치 제조업"},{"code":"30393","name":"자동차용 신품 의자 제조업"},{"code":"30399","name":"그 외 자동차용 신품 부품 제조업"},{"code":"30400","name":"자동차 재제조 부품 제조업"},{"code":"31111","name":"강선 건조업"},{"code":"31112","name":"합성수지선 건조업"},{"code":"31113","name":"기타 선박 건조업"},{"code":"31114","name":"선박 구성 부분품 제조업"},{"code":"31120","name":"오락 및 스포츠용 보트 건조업"},{"code":"31201","name":"기관차 및 기타 철도차량 제조업"},{"code":"31202","name":"철도차량 부품 및 관련 장치물 제조업"},{"code":"31311","name":"유인 항공기, 항공우주선 및 보조장치 제조업"},{"code":"31312","name":"무인 항공기 및 무인 비행장치 제조업"},{"code":"31321","name":"항공기용 엔진 제조업"},{"code":"31322","name":"항공기용 부품 제조업"},{"code":"31910","name":"전투용 차량 제조업"},{"code":"31920","name":"모터사이클 제조업"},{"code":"31921","name":"모터사이클 제조업"},{"code":"31922","name":"개인용 전기식 이동수단 제조업"},{"code":"31991","name":"자전거 및 환자용 차량 제조업"},{"code":"31999","name":"그 외 기타 달리 분류되지 않은 운송장비 제조업"},{"code":"32011","name":"매트리스 및 침대 제조업"},{"code":"32019","name":"소파 및 기타 내장가구 제조업"},{"code":"32021","name":"주방용 및 음식점용 목재가구 제조업"},{"code":"32029","name":"기타 목재가구 제조업"},{"code":"32091","name":"금속 가구 제조업"},{"code":"32099","name":"그 외 기타 가구 제조업"},{"code":"33110","name":"귀금속 및 관련제품 제조업"},{"code":"33120","name":"모조 귀금속 및 모조 장신용품 제조업"},{"code":"33201","name":"건반 악기 제조업"},{"code":"33202","name":"전자 악기 제조업"},{"code":"33209","name":"기타 악기 및 전자 악기 제조업"},{"code":"33301","name":"체조, 육상 및 체력단련용 장비 제조업"},{"code":"33302","name":"놀이터용 장비 제조업"},{"code":"33303","name":"낚시 및 수렵용구 제조업"},{"code":"33309","name":"기타 운동 및 경기용구 제조업"},{"code":"33401","name":"인형 및 장난감 제조업"},{"code":"33402","name":"영상게임기 제조업"},{"code":"33409","name":"기타 오락용품 제조업"},{"code":"33910","name":"간판 및 광고물 제조업"},{"code":"33920","name":"사무 및 회화용품 제조업"},{"code":"33931","name":"가발 및 유사 제품 제조업"},{"code":"33932","name":"전시용 모형 제조업"},{"code":"33933","name":"표구처리업"},{"code":"33991","name":"단추 및 유사 파스너 제조업"},{"code":"33992","name":"라이터, 연소물 및 흡연용품 제조업"},{"code":"33993","name":"비 및 솔 제조업"},{"code":"33999","name":"그 외 기타 달리 분류되지 않은 제품 제조업"},{"code":"34011","name":"건설ㆍ광업용 기계 및 장비 수리업"},{"code":"34019","name":"기타 일반 기계 및 장비 수리업"},{"code":"34020","name":"전기ㆍ전자 및 정밀기기 수리업"},{"code":"35111","name":"원자력 발전업"},{"code":"35112","name":"수력 발전업"},{"code":"35113","name":"화력 발전업"},{"code":"35114","name":"태양력 발전업"},{"code":"35115","name":"풍력 발전업"},{"code":"35119","name":"기타 발전업"},{"code":"35120","name":"송전 및 배전업"},{"code":"35130","name":"전기 판매업"},{"code":"35200","name":"연료용 가스 제조 및 배관공급업"},{"code":"35300","name":"증기, 냉ㆍ온수 및 공기조절 공급업"},{"code":"36010","name":"생활용수 공급업"},{"code":"36020","name":"산업용수 공급업"},{"code":"37011","name":"하수 처리업"},{"code":"37012","name":"폐수 처리업"},{"code":"37021","name":"사람 분뇨 처리업"},{"code":"37022","name":"축산 분뇨 처리업"},{"code":"38110","name":"지정 외 폐기물 수집, 운반업"},{"code":"38120","name":"지정 폐기물 수집, 운반업"},{"code":"38130","name":"건설 폐기물 수집, 운반업"},{"code":"38210","name":"지정 외 폐기물 처리업"},{"code":"38220","name":"지정 폐기물 처리업"},{"code":"38230","name":"건설 폐기물 처리업"},{"code":"38240","name":"방사성 폐기물 수집, 운반 및 처리업"},{"code":"38311","name":"금속류 해체 및 선별업"},{"code":"38312","name":"금속류 원료 재생업"},{"code":"38321","name":"비금속류 해체 및 선별업"},{"code":"38322","name":"비금속류 원료 재생업"},{"code":"39001","name":"토양 및 지하수 정화업"},{"code":"39009","name":"기타 환경 정화 및 복원업"},{"code":"41111","name":"단독 주택 건설업"},{"code":"41112","name":"아파트 건설업"},{"code":"41119","name":"기타 공동 주택 건설업"},{"code":"41121","name":"사무ㆍ상업용 및 공공기관용 건물 건설업"},{"code":"41122","name":"제조업 및 유사 산업용 건물 건설업"},{"code":"41129","name":"기타 비주거용 건물 건설업"},{"code":"41210","name":"지반조성 건설업"},{"code":"41221","name":"도로 건설업"},{"code":"41222","name":"교량, 터널 및 철도 건설업"},{"code":"41223","name":"항만, 수로, 댐 및 유사 구조물 건설업"},{"code":"41224","name":"환경설비 건설업"},{"code":"41225","name":"산업생산시설 종합건설업"},{"code":"41226","name":"조경 건설업"},{"code":"41229","name":"기타 토목시설물 건설업"},{"code":"42110","name":"건물 및 구축물 해체 공사업"},{"code":"42121","name":"토공사업"},{"code":"42122","name":"보링, 그라우팅 및 관정 공사업"},{"code":"42123","name":"파일공사 및 축조관련 기초 공사업"},{"code":"42129","name":"기타 기반조성 관련 전문공사업"},{"code":"42131","name":"철골 및 관련 구조물 공사업"},{"code":"42132","name":"콘크리트 및 철근 공사업"},{"code":"42191","name":"조적 및 석공사업"},{"code":"42192","name":"포장 공사업"},{"code":"42193","name":"철도궤도 전문공사업"},{"code":"42194","name":"수중 공사업"},{"code":"42195","name":"비계 및 형틀 공사업"},{"code":"42196","name":"지붕, 내ㆍ외벽 축조 관련 전문 공사업"},{"code":"42199","name":"기타 옥외 시설물 축조 관련 전문공사업"},{"code":"42201","name":"배관 및 냉ㆍ난방 공사업"},{"code":"42202","name":"건물용 기계ㆍ장비 설치 공사업"},{"code":"42203","name":"승강설비 설치 공사업"},{"code":"42204","name":"방음, 방진 및 내화 공사업"},{"code":"42205","name":"소방시설 공사업"},{"code":"42209","name":"기타 건물 관련설비 설치 공사업"},{"code":"42311","name":"일반전기 공사업"},{"code":"42312","name":"내부 전기배선 공사업"},{"code":"42321","name":"일반 통신 공사업"},{"code":"42322","name":"내부 통신배선 공사업"},{"code":"42411","name":"도장 공사업"},{"code":"42412","name":"도배, 실내장식 및 내장 목공사업"},{"code":"42420","name":"유리 및 창호 공사업"},{"code":"42491","name":"미장, 타일 및 방수 공사업"},{"code":"42492","name":"건물용 금속공작물 설치 공사업"},{"code":"42499","name":"그 외 기타 건축 마무리 공사업"},{"code":"42500","name":"시설물 유지관리 공사업"},{"code":"42600","name":"건설장비 운영업"},{"code":"45110","name":"자동차 신품 판매업"},{"code":"45120","name":"중고 자동차 판매업"},{"code":"45211","name":"자동차 신품 타이어 및 튜브 판매업"},{"code":"45212","name":"자동차용 전용 신품 부품 판매업"},{"code":"45213","name":"자동차 내장용 신품 전기ㆍ전자ㆍ정밀 기기판매업"},{"code":"45219","name":"기타 자동차 신품 부품 및 내장품 판매업"},{"code":"45220","name":"자동차 중고 부품 및 내장품 판매업"},{"code":"45301","name":"모터사이클 및 부품 도매업"},{"code":"45302","name":"모터사이클 및 부품 소매업"},{"code":"46101","name":"산업용 농ㆍ축산물, 섬유 원료 및 동물 중개업"},{"code":"46102","name":"음·식료품 및 담배 중개업"},{"code":"46103","name":"섬유, 의복, 신발 및 가죽제품 중개업"},{"code":"46104","name":"목재 및 건축자재 중개업"},{"code":"46105","name":"연료, 광물, 1차 금속, 비료 및 화학제품 중개업"},{"code":"46106","name":"기계 및 장비 중개업"},{"code":"46107","name":"그 외 기타 특정 상품 중개업"},{"code":"46109","name":"상품 종합 중개업"},{"code":"46201","name":"곡물 및 유지작물 도매업"},{"code":"46202","name":"종자 및 묘목 도매업"},{"code":"46203","name":"사료 도매업"},{"code":"46204","name":"화훼류 및 식물 도매업"},{"code":"46205","name":"육지 동물 및 반려 동물 도매업"},{"code":"46209","name":"기타 산업용 농산물 도매업"},{"code":"46311","name":"과실류 도매업"},{"code":"46312","name":"채소류, 서류 및 향신작물류 도매업"},{"code":"46313","name":"육류 도매업"},{"code":"46314","name":"건어물 및 젓갈류 도매업"},{"code":"46315","name":"신선, 냉동 및 기타 수산물 도매업"},{"code":"46319","name":"기타 신선식품 및 단순 가공식품 도매업"},{"code":"46321","name":"육류 가공식품 도매업"},{"code":"46322","name":"수산물 가공식품 도매업"},{"code":"46323","name":"빵류, 과자류, 당류, 초콜릿 도매업"},{"code":"46324","name":"낙농품 및 동ㆍ식물성 유지 도매업"},{"code":"46325","name":"커피 및 차류 도매업"},{"code":"46326","name":"조미료 도매업"},{"code":"46329","name":"기타 가공식품 도매업"},{"code":"46331","name":"주류 도매업"},{"code":"46332","name":"비알코올음료 도매업"},{"code":"46333","name":"담배 도매업"},{"code":"46411","name":"생활용 섬유 및 실 도매업"},{"code":"46412","name":"커튼 및 침구용품 도매업"},{"code":"46413","name":"남녀용 겉옷 및 셔츠 도매업"},{"code":"46414","name":"유아용 의류 도매업"},{"code":"46415","name":"속옷 및 잠옷 도매업"},{"code":"46416","name":"가죽 및 모피제품 도매업"},{"code":"46417","name":"의복 액세서리 및 모조 장신구 도매업"},{"code":"46419","name":"기타 생활용 섬유 및 직물제품 도매업"},{"code":"46420","name":"신발 도매업"},{"code":"46431","name":"생활용 가구 도매업"},{"code":"46432","name":"전구, 램프 및 조명장치 도매업"},{"code":"46433","name":"생활용 유리ㆍ요업ㆍ목재ㆍ금속 제품 및 날붙이 도매업"},{"code":"46439","name":"기타 비전기식 생활용 기기 및 기구 도매업"},{"code":"46441","name":"의약품 도매업"},{"code":"46442","name":"의료용품 도매업"},{"code":"46443","name":"화장품 및 화장용품 도매업"},{"code":"46444","name":"비누 및 세정제 도매업"},{"code":"46451","name":"생활용 포장 및 위생용품, 봉투 및 유사 제품 도매업"},{"code":"46452","name":"문구용품, 회화용품, 사무용품 도매업"},{"code":"46453","name":"서적, 잡지 및 기타 인쇄물 도매업"},{"code":"46461","name":"음반 및 비디오물 도매업"},{"code":"46462","name":"악기 도매업"},{"code":"46463","name":"장난감 및 취미, 오락용품 도매업"},{"code":"46464","name":"운동 및 경기용품 도매업"},{"code":"46465","name":"자전거 및 기타 운송장비 도매업"},{"code":"46491","name":"가방 및 보호용 케이스 도매업"},{"code":"46492","name":"시계 및 귀금속제품 도매업"},{"code":"46493","name":"안경, 사진장비 및 광학용품 도매업"},{"code":"46499","name":"그 외 기타 생활용품 도매업"},{"code":"46510","name":"컴퓨터 및 주변장치, 소프트웨어 도매업"},{"code":"46521","name":"가전제품 및 부품 도매업"},{"code":"46522","name":"통신ㆍ방송장비 및 부품 도매업"},{"code":"46531","name":"농림업용 기계 및 장비 도매업"},{"code":"46532","name":"건설ㆍ광업용 기계 및 장비 도매업"},{"code":"46533","name":"공작용 기계 및 장비 도매업"},{"code":"46539","name":"기타 산업용 기계 및 장비 도매업"},{"code":"46591","name":"사무용 가구 및 기기 도매업"},{"code":"46592","name":"의료기기 도매업"},{"code":"46593","name":"정밀기기 및 과학기기 도매업"},{"code":"46594","name":"수송용 운송장비 도매업"},{"code":"46595","name":"전기용 기계ㆍ장비 및 관련 기자재 도매업"},{"code":"46596","name":"전지 및 케이블 도매업"},{"code":"46599","name":"그 외 기타 기계 및 장비 도매업"},{"code":"46611","name":"원목 및 건축관련 목제품 도매업"},{"code":"46612","name":"골재, 벽돌 및 시멘트 도매업"},{"code":"46613","name":"유리 및 창호 도매업"},{"code":"46621","name":"배관 및 냉ㆍ난방장치 도매업"},{"code":"46622","name":"철물, 금속 파스너 및 수공구 도매업"},{"code":"46691","name":"도료 도매업"},{"code":"46692","name":"벽지 및 장판류 도매업"},{"code":"46699","name":"그 외 기타 건축자재 도매업"},{"code":"46711","name":"고체연료 및 관련제품 도매업"},{"code":"46712","name":"액체연료 및 관련제품 도매업"},{"code":"46713","name":"기체연료 및 관련제품 도매업"},{"code":"46721","name":"1차 금속제품 도매업"},{"code":"46722","name":"금속광물 도매업"},{"code":"46731","name":"염료, 안료 및 관련제품 도매업"},{"code":"46732","name":"비료 및 농약 도매업"},{"code":"46733","name":"플라스틱물질 및 합성고무 도매업"},{"code":"46739","name":"기타 화학물질 및 화학제품 도매업"},{"code":"46741","name":"방직용 섬유 및 실 도매업"},{"code":"46742","name":"직물 도매업"},{"code":"46750","name":"종이 원지, 판지, 종이상자 도매업"},{"code":"46791","name":"재생용 재료 수집 및 판매업"},{"code":"46799","name":"그 외 기타 상품 전문 도매업"},{"code":"46800","name":"상품 종합 도매업"},{"code":"47111","name":"백화점"},{"code":"47112","name":"대형 마트"},{"code":"47119","name":"기타 대형 종합 소매업"},{"code":"47121","name":"슈퍼마켓"},{"code":"47122","name":"체인화 편의점"},{"code":"47129","name":"기타 음ㆍ식료품 위주 종합 소매업"},{"code":"47130","name":"면세점"},{"code":"47190","name":"그 외 기타 종합 소매업"},{"code":"47211","name":"곡물, 곡분 및 가축 사료 소매업"},{"code":"47212","name":"육류 소매업"},{"code":"47213","name":"건어물 및 젓갈류 소매업"},{"code":"47214","name":"신선, 냉동 및 기타 수산물 소매업"},{"code":"47215","name":"채소, 과실 및 뿌리작물 소매업"},{"code":"47219","name":"기타 신선식품 및 단순 가공식품 소매업"},{"code":"47221","name":"빵류, 과자류 및 당류 소매업"},{"code":"47222","name":"건강 보조식품 소매업"},{"code":"47223","name":"조리 반찬류 소매업"},{"code":"47229","name":"기타 가공식품 소매업"},{"code":"47231","name":"음료 소매업"},{"code":"47232","name":"담배 소매업"},{"code":"47311","name":"컴퓨터 및 주변장치, 소프트웨어 소매업"},{"code":"47312","name":"통신기기 소매업"},{"code":"47320","name":"가전제품 소매업"},{"code":"47411","name":"남자용 겉옷 소매업"},{"code":"47412","name":"여자용 겉옷 소매업"},{"code":"47413","name":"속옷 및 잠옷 소매업"},{"code":"47414","name":"셔츠 및 블라우스 소매업"},{"code":"47415","name":"한복 소매업"},{"code":"47416","name":"가죽 및 모피의복 소매업"},{"code":"47417","name":"유아용 의류 소매업"},{"code":"47419","name":"기타 의복 소매업"},{"code":"47421","name":"가정용 직물제품 소매업"},{"code":"47422","name":"의복 액세서리 및 모조 장신구 소매업"},{"code":"47429","name":"섬유 원단, 실 및 기타 섬유제품 소매업"},{"code":"47430","name":"신발 소매업"},{"code":"47440","name":"가방 및 기타 가죽제품 소매업"},{"code":"47511","name":"철물 및 난방용구 소매업"},{"code":"47512","name":"공구 소매업"},{"code":"47513","name":"벽지, 마루덮개 및 장판류 소매업"},{"code":"47519","name":"페인트, 창호 및 기타 건설자재 소매업"},{"code":"47520","name":"가구 소매업"},{"code":"47591","name":"전기용품 및 조명장치 소매업"},{"code":"47592","name":"주방용품 및 가정용 유리, 요업 제품 소매업"},{"code":"47593","name":"악기 소매업"},{"code":"47599","name":"그 외 기타 분류 안된 가정용품 소매업"},{"code":"47611","name":"서적, 신문 및 잡지류 소매업"},{"code":"47612","name":"문구용품 및 회화용품 소매업"},{"code":"47620","name":"음반 및 비디오물 소매업"},{"code":"47631","name":"운동 및 경기용품 소매업"},{"code":"47632","name":"자전거 및 기타 운송장비 소매업"},{"code":"47640","name":"게임용구, 인형 및 장난감 소매업"},{"code":"47711","name":"운송장비용 주유소 운영업"},{"code":"47712","name":"운송장비용 수소 충전업"},{"code":"47713","name":"운송장비용 기타 가스 충전업"},{"code":"47721","name":"가정용 고체연료 소매업"},{"code":"47722","name":"가정용 액체연료 소매업"},{"code":"47723","name":"가정용 가스연료 소매업"},{"code":"47811","name":"의약품 및 의료용품 소매업"},{"code":"47812","name":"의료용 기구 소매업"},{"code":"47813","name":"화장품, 비누 및 방향제 소매업"},{"code":"47821","name":"사무용 기기 소매업"},{"code":"47822","name":"안경 및 렌즈 소매업"},{"code":"47823","name":"사진기 및 사진용품 소매업"},{"code":"47829","name":"기타 광학 및 정밀 기기 소매업"},{"code":"47830","name":"시계 및 귀금속 소매업"},{"code":"47841","name":"예술품 및 골동품 소매업"},{"code":"47842","name":"기념품, 관광 민예품 및 장식용품 소매업"},{"code":"47851","name":"화초 및 식물 소매업"},{"code":"47852","name":"반려용 동물 및 관련용품 소매업"},{"code":"47859","name":"그 외 기타 분류 안된 상품 전문 소매업"},{"code":"47861","name":"중고 가구 소매업"},{"code":"47862","name":"중고 가전제품 및 통신장비 소매업"},{"code":"47869","name":"기타 중고 상품 소매업"},{"code":"47911","name":"전자상거래 소매 중개업"},{"code":"47912","name":"전자상거래 소매업"},{"code":"47919","name":"기타 통신 판매업"},{"code":"47920","name":"노점 및 유사이동 소매업"},{"code":"47991","name":"자동판매기 운영업"},{"code":"47992","name":"계약배달 판매업"},{"code":"47993","name":"방문 판매업"},{"code":"47999","name":"그 외 기타 무점포 소매업"},{"code":"49101","name":"철도 여객 운송업"},{"code":"49102","name":"철도 화물 운송업"},{"code":"49211","name":"도시철도 운송업"},{"code":"49212","name":"시내버스 운송업"},{"code":"49219","name":"기타 도시 정기 육상 여객 운송업"},{"code":"49220","name":"시외버스 운송업"},{"code":"49231","name":"택시 운송업"},{"code":"49232","name":"전세버스 운송업"},{"code":"49233","name":"특수여객자동차 운송업"},{"code":"49239","name":"기타 부정기 여객 육상 운송업"},{"code":"49301","name":"일반 화물자동차 운송업"},{"code":"49302","name":"개인 화물자동차 운송업"},{"code":"49303","name":"개별 화물자동차 운송업"},{"code":"49309","name":"기타 도로화물 운송업"},{"code":"49401","name":"택배업"},{"code":"49402","name":"늘찬 배달업"},{"code":"49500","name":"파이프라인 운송업"},{"code":"50111","name":"외항 여객 운송업"},{"code":"50112","name":"외항 화물 운송업"},{"code":"50121","name":"내항 여객 운송업"},{"code":"50122","name":"내항 화물 운송업"},{"code":"50130","name":"기타 해상 운송업"},{"code":"50201","name":"항만 내 여객 운송업"},{"code":"50209","name":"기타 내륙 수상 여객 및 화물 운송업"},{"code":"51100","name":"항공 여객 운송업"},{"code":"51200","name":"항공 화물 운송업"},{"code":"52101","name":"일반 창고업"},{"code":"52102","name":"냉장 및 냉동 창고업"},{"code":"52103","name":"농산물 창고업"},{"code":"52104","name":"위험물품 보관업"},{"code":"52109","name":"기타 보관 및 창고업"},{"code":"52911","name":"철도 운송지원 서비스업"},{"code":"52912","name":"여객 자동차 터미널 운영업"},{"code":"52913","name":"물류 터미널 운영업"},{"code":"52914","name":"도로 및 관련시설 운영업"},{"code":"52915","name":"주차장 운영업"},{"code":"52919","name":"기타 육상 운송지원 서비스업"},{"code":"52921","name":"항구 및 기타 해상 터미널 운영업"},{"code":"52922","name":"선박관리업"},{"code":"52929","name":"기타 수상 운송지원 서비스업"},{"code":"52931","name":"공항 운영업"},{"code":"52939","name":"기타 항공 운송지원 서비스업"},{"code":"52941","name":"항공 및 육상 화물 취급업"},{"code":"52942","name":"수상 화물 취급업"},{"code":"52991","name":"통관 대리 및 관련서비스업"},{"code":"52992","name":"화물운송 중개, 대리 및 관련 서비스업"},{"code":"52993","name":"화물 포장, 검수 및 계량 서비스업"},{"code":"52999","name":"그 외 기타 분류 안된 운송 관련 서비스업"},{"code":"55101","name":"호텔업"},{"code":"55102","name":"여관업"},{"code":"55103","name":"휴양콘도 운영업"},{"code":"55104","name":"민박업"},{"code":"55105","name":"야영장업"},{"code":"55109","name":"기타 일반 및 생활 숙박시설 운영업"},{"code":"55901","name":"기숙사 및 고시원 운영업"},{"code":"55909","name":"그 외 기타 숙박업"},{"code":"56111","name":"한식 일반 음식점업"},{"code":"56112","name":"한식 면요리 전문점"},{"code":"56113","name":"한식 육류요리 전문점"},{"code":"56114","name":"한식 해산물요리 전문점"},{"code":"56121","name":"중식 음식점업"},{"code":"56122","name":"일식 음식점업"},{"code":"56123","name":"서양식 음식점업"},{"code":"56129","name":"기타 외국식 음식점업"},{"code":"56130","name":"기관 구내식당업"},{"code":"56141","name":"출장 음식 서비스업"},{"code":"56142","name":"이동 음식점업"},{"code":"56150","name":"제과점업"},{"code":"56161","name":"피자, 햄버거, 샌드위치 및 유사 음식점업"},{"code":"56162","name":"치킨 전문점"},{"code":"56191","name":"김밥 및 기타 간이 음식점업"},{"code":"56199","name":"간이음식 포장 판매 전문점"},{"code":"56211","name":"일반 유흥주점업"},{"code":"56212","name":"무도 유흥주점업"},{"code":"56213","name":"생맥주 전문점"},{"code":"56219","name":"기타 주점업"},{"code":"56221","name":"커피 전문점"},{"code":"56229","name":"기타 비알코올 음료점업"},{"code":"58111","name":"교과서 및 학습서적 출판업"},{"code":"58112","name":"만화 출판업"},{"code":"58113","name":"일반 서적 출판업"},{"code":"58121","name":"신문 발행업"},{"code":"58122","name":"잡지 및 정기간행물 발행업"},{"code":"58123","name":"정기 광고간행물 발행업"},{"code":"58190","name":"기타 인쇄물 출판업"},{"code":"58211","name":"유선 온라인 게임 소프트웨어 개발 및 공급업"},{"code":"58212","name":"모바일 게임 소프트웨어 개발 및 공급업"},{"code":"58219","name":"기타 게임 소프트웨어 개발 및 공급업"},{"code":"58221","name":"시스템 소프트웨어 개발 및 공급업"},{"code":"58222","name":"응용 소프트웨어 개발 및 공급업"},{"code":"59111","name":"일반 영화 및 비디오물 제작업"},{"code":"59112","name":"애니메이션 영화 및 비디오물 제작업"},{"code":"59113","name":"광고 영화 및 비디오물 제작업"},{"code":"59114","name":"방송 프로그램 제작업"},{"code":"59120","name":"영화, 비디오물 및 방송프로그램 제작 관련 서비스업"},{"code":"59130","name":"영화, 비디오물 및 방송프로그램 배급업"},{"code":"59141","name":"영화관 운영업"},{"code":"59142","name":"비디오물 감상실 운영업"},{"code":"59201","name":"음악 및 기타 오디오물 출판업"},{"code":"59202","name":"녹음시설 운영업"},{"code":"60100","name":"라디오 방송업"},{"code":"60210","name":"지상파 방송업"},{"code":"60221","name":"프로그램 공급업"},{"code":"60222","name":"유선 방송업"},{"code":"60229","name":"위성 및 기타 방송업"},{"code":"60310","name":"영상물 제공 서비스업"},{"code":"60320","name":"오디오물 제공 서비스업"},{"code":"61100","name":"공영 우편업"},{"code":"61210","name":"유선 통신업"},{"code":"61220","name":"무선 및 위성 통신업"},{"code":"61291","name":"통신 재판매업"},{"code":"61299","name":"그 외 기타 전기 통신업"},{"code":"62010","name":"컴퓨터 프로그래밍 서비스업"},{"code":"62021","name":"컴퓨터시스템 통합 자문 및 구축 서비스업"},{"code":"62022","name":"컴퓨터시설 관리업"},{"code":"62090","name":"기타 정보기술 및 컴퓨터운영 관련 서비스업"},{"code":"63111","name":"자료 처리업"},{"code":"63112","name":"호스팅 및 관련 서비스업"},{"code":"63120","name":"포털 및 기타 인터넷 정보매개 서비스업"},{"code":"63910","name":"뉴스 제공업"},{"code":"63991","name":"데이터베이스 및 온라인 정보 제공업"},{"code":"63992","name":"가상자산 매매 및 중개업"},{"code":"63999","name":"그 외 기타 정보 서비스업"},{"code":"64110","name":"중앙은행"},{"code":"64121","name":"국내은행"},{"code":"64122","name":"외국은행"},{"code":"64131","name":"신용조합"},{"code":"64132","name":"상호저축은행 및 기타 저축기관"},{"code":"64201","name":"신탁업 및 집합투자업"},{"code":"64209","name":"기타 금융 투자업"},{"code":"64911","name":"금융리스업"},{"code":"64912","name":"개발금융기관"},{"code":"64913","name":"신용카드 및 할부금융업"},{"code":"64919","name":"그 외 기타 여신 금융업"},{"code":"64991","name":"기금 운영업"},{"code":"64992","name":"지주회사"},{"code":"64999","name":"그 외 기타 분류 안된 금융업"},{"code":"65110","name":"생명 보험업"},{"code":"65121","name":"손해 보험업"},{"code":"65122","name":"보증 보험업"},{"code":"65131","name":"건강보험업"},{"code":"65139","name":"산업 재해 및 기타 사회보장 보험업"},{"code":"65200","name":"재 보험업"},{"code":"65301","name":"개인 공제업"},{"code":"65302","name":"사업 공제업"},{"code":"65303","name":"연금업"},{"code":"66110","name":"금융시장 관리업"},{"code":"66121","name":"증권 중개업"},{"code":"66122","name":"선물 중개업"},{"code":"66191","name":"증권 발행, 관리, 보관 및 거래 지원 서비스업"},{"code":"66192","name":"투자 자문업 및 투자 일임업"},{"code":"66199","name":"그 외 기타 금융 지원 서비스업"},{"code":"66201","name":"손해 사정업"},{"code":"66202","name":"보험 대리 및 중개업"},{"code":"66209","name":"기타 보험 및 연금관련 서비스업"},{"code":"68111","name":"주거용 건물 임대업"},{"code":"68112","name":"비주거용 건물 임대업"},{"code":"68119","name":"기타 부동산 임대업"},{"code":"68121","name":"주거용 건물 개발 및 공급업"},{"code":"68122","name":"비주거용 건물 개발 및 공급업"},{"code":"68129","name":"기타 부동산 개발 및 공급업"},{"code":"68211","name":"주거용 부동산 관리업"},{"code":"68212","name":"비주거용 부동산 관리업"},{"code":"68221","name":"부동산 중개 및 대리업"},{"code":"68222","name":"부동산 투자자문업"},{"code":"68223","name":"부동산 감정평가업"},{"code":"68224","name":"부동산 분양 대행업"},{"code":"70111","name":"물리, 화학 및 생물학 연구개발업"},{"code":"70112","name":"농림수산학 및 수의학 연구개발업"},{"code":"70113","name":"의학 및 약학 연구개발업"},{"code":"70119","name":"기타 자연과학 연구개발업"},{"code":"70121","name":"전기ㆍ전자공학 연구개발업"},{"code":"70129","name":"기타 공학 연구개발업"},{"code":"70130","name":"자연과학 및 공학 융합 연구개발업"},{"code":"70201","name":"경제 및 경영학 연구개발업"},{"code":"70209","name":"기타 인문 및 사회과학 연구개발업"},{"code":"71101","name":"변호사업"},{"code":"71102","name":"변리사업"},{"code":"71103","name":"법무사업"},{"code":"71109","name":"기타 법무관련 서비스업"},{"code":"71201","name":"공인회계사업"},{"code":"71202","name":"세무사업"},{"code":"71209","name":"기타 회계 관련 서비스업"},{"code":"71310","name":"광고 대행업"},{"code":"71391","name":"옥외 광고업"},{"code":"71392","name":"광고물 문안, 도안, 설계 등 작성업"},{"code":"71399","name":"그 외 기타 광고 관련 서비스업"},{"code":"71400","name":"시장조사 및 여론조사업"},{"code":"71511","name":"제조업 회사 본부"},{"code":"71519","name":"기타 산업 회사 본부"},{"code":"71531","name":"경영 컨설팅업"},{"code":"71532","name":"공공관계 서비스업"},{"code":"71600","name":"기타 전문 서비스업"},{"code":"72111","name":"건축설계 및 관련 서비스업"},{"code":"72112","name":"도시계획 및 조경설계 서비스업"},{"code":"72121","name":"건물 및 토목 엔지니어링 서비스업"},{"code":"72122","name":"환경 관련 엔지니어링 서비스업"},{"code":"72129","name":"기타 엔지니어링 서비스업"},{"code":"72911","name":"물질성분 검사 및 분석업"},{"code":"72919","name":"기타 기술 시험, 검사 및 분석업"},{"code":"72921","name":"측량업"},{"code":"72922","name":"제도업"},{"code":"72923","name":"지질 조사·탐사 및 지도 제작업"},{"code":"72924","name":"지도 제작업"},{"code":"73100","name":"수의업"},{"code":"73201","name":"인테리어 디자인업"},{"code":"73202","name":"제품 디자인업"},{"code":"73203","name":"시각 디자인업"},{"code":"73209","name":"패션, 섬유류 및 기타 전문 디자인업"},{"code":"73301","name":"인물사진 및 행사용 영상 촬영업"},{"code":"73302","name":"상업용 사진 촬영업"},{"code":"73303","name":"사진 처리업"},{"code":"73901","name":"매니저업"},{"code":"73902","name":"번역 및 통역 서비스업"},{"code":"73903","name":"사업 및 무형 재산권 중개업"},{"code":"73904","name":"물품 감정, 계량 및 견본 추출업"},{"code":"73905","name":"고고유산 조사연구 서비스업"},{"code":"73909","name":"그 외 기타 분류 안된 전문, 과학 및 기술 서비스업"},{"code":"74100","name":"사업시설 유지ㆍ관리 서비스업"},{"code":"74211","name":"건축물 일반 청소업"},{"code":"74212","name":"산업설비, 운송장비 및 공공장소 청소업"},{"code":"74220","name":"소독, 구충 및 방제 서비스업"},{"code":"74300","name":"조경 관리 및 유지 서비스업"},{"code":"75110","name":"고용 알선업"},{"code":"75121","name":"임시 및 일용 인력 공급업"},{"code":"75122","name":"상용 인력 공급 및 인사관리 서비스업"},{"code":"75210","name":"여행사업"},{"code":"75290","name":"기타 여행 보조 및 예약 서비스업"},{"code":"75310","name":"경비 및 경호 서비스업"},{"code":"75320","name":"보안시스템 서비스업"},{"code":"75330","name":"탐정 및 조사 서비스업"},{"code":"75911","name":"문서 작성 및 복사업"},{"code":"75912","name":"복사업"},{"code":"75919","name":"기타 사무지원 서비스업"},{"code":"75991","name":"콜센터 및 텔레마케팅 서비스업"},{"code":"75992","name":"전시, 컨벤션 및 행사 대행업"},{"code":"75993","name":"신용 조사 및 추심 대행업"},{"code":"75994","name":"포장 및 충전업"},{"code":"75995","name":"온라인 활용 마케팅 및 관련 사업지원 서비스업"},{"code":"75999","name":"그 외 기타 분류 안된 사업지원 서비스업"},{"code":"76110","name":"자동차 임대업"},{"code":"76190","name":"기타 운송장비 임대업"},{"code":"76210","name":"스포츠 및 레크리에이션 용품 임대업"},{"code":"76220","name":"음반 및 비디오물 임대업"},{"code":"76291","name":"서적 임대업"},{"code":"76292","name":"의류 임대업"},{"code":"76299","name":"그 외 기타 개인 및 가정용품 임대업"},{"code":"76310","name":"건설 및 토목공사용 기계ㆍ장비 임대업"},{"code":"76320","name":"컴퓨터 및 사무용 기계ㆍ장비 임대업"},{"code":"76390","name":"기타 산업용 기계 및 장비 임대업"},{"code":"76400","name":"무형재산권 임대업"},{"code":"84111","name":"입법기관"},{"code":"84112","name":"중앙 최고 집행기관"},{"code":"84113","name":"지방행정 집행기관"},{"code":"84114","name":"재정 및 경제정책 행정"},{"code":"84119","name":"기타 일반 공공 행정"},{"code":"84120","name":"정부기관 일반 보조 행정"},{"code":"84211","name":"교육 행정"},{"code":"84212","name":"문화 및 관광 행정"},{"code":"84213","name":"환경 행정"},{"code":"84214","name":"보건 및 복지 행정"},{"code":"84219","name":"기타 사회서비스 관리 행정"},{"code":"84221","name":"노동 행정"},{"code":"84222","name":"농림수산 행정"},{"code":"84223","name":"건설 및 운송 행정"},{"code":"84224","name":"우편 및 통신행정"},{"code":"84229","name":"기타 산업진흥 행정"},{"code":"84310","name":"외무 행정"},{"code":"84320","name":"국방 행정"},{"code":"84401","name":"법원 및 사법 서비스"},{"code":"84402","name":"검찰 및 공소 유지"},{"code":"84403","name":"교도기관"},{"code":"84404","name":"경찰 서비스"},{"code":"84405","name":"소방서"},{"code":"84409","name":"기타 사법 및 공공질서 행정"},{"code":"84500","name":"사회보장 행정"},{"code":"84611","name":"건강보험업"},{"code":"84619","name":"산업 재해 및 기타 사회보장보험업"},{"code":"84620","name":"연금업"},{"code":"85110","name":"유아 교육기관"},{"code":"85120","name":"초등학교"},{"code":"85211","name":"중학교"},{"code":"85212","name":"일반 고등학교"},{"code":"85221","name":"상업 및 정보산업 특성화 고등학교"},{"code":"85222","name":"공업 특성화 고등학교"},{"code":"85229","name":"기타 특성화 고등학교"},{"code":"85301","name":"전문대학"},{"code":"85302","name":"대학교"},{"code":"85303","name":"대학원"},{"code":"85410","name":"특수학교"},{"code":"85420","name":"외국인 학교"},{"code":"85430","name":"대안학교"},{"code":"85501","name":"일반 교과 학원"},{"code":"85502","name":"방문 교육 학원"},{"code":"85503","name":"온라인 교육 학원"},{"code":"85611","name":"태권도 및 무술 교육기관"},{"code":"85612","name":"기타 스포츠 교육기관"},{"code":"85613","name":"레크리에이션 교육기관"},{"code":"85614","name":"청소년 수련시설 운영업"},{"code":"85621","name":"음악학원"},{"code":"85622","name":"미술학원"},{"code":"85629","name":"기타 예술학원"},{"code":"85631","name":"외국어학원"},{"code":"85632","name":"기타 교습학원"},{"code":"85640","name":"사회교육시설"},{"code":"85650","name":"직원훈련기관"},{"code":"85661","name":"운전학원"},{"code":"85669","name":"기타 기술 및 직업훈련학원"},{"code":"85691","name":"컴퓨터 학원"},{"code":"85699","name":"그 외 기타 분류 안된 교육기관"},{"code":"85701","name":"교육관련 자문 및 평가업"},{"code":"85709","name":"기타 교육지원 서비스업"},{"code":"86101","name":"종합 병원"},{"code":"86102","name":"일반 병원"},{"code":"86103","name":"치과 병원"},{"code":"86104","name":"한방 병원"},{"code":"86105","name":"요양 병원"},{"code":"86201","name":"일반 의원"},{"code":"86202","name":"치과 의원"},{"code":"86203","name":"한의원"},{"code":"86204","name":"방사선 진단 및 병리 검사 의원"},{"code":"86300","name":"공중 보건 의료업"},{"code":"86901","name":"앰뷸런스 서비스업"},{"code":"86902","name":"유사 의료업"},{"code":"86909","name":"그 외 기타 보건업"},{"code":"87111","name":"노인 요양 복지시설 운영업"},{"code":"87112","name":"노인 양로 복지시설 운영업"},{"code":"87121","name":"신체 부자유자 거주 복지시설 운영업"},{"code":"87122","name":"정신질환, 정신지체 및 약물 중독자 거주 복지시설 운영업"},{"code":"87131","name":"아동 및 부녀자 거주 복지시설 운영업"},{"code":"87139","name":"그 외 기타 거주 복지시설 운영업"},{"code":"87210","name":"보육시설 운영업"},{"code":"87291","name":"직업재활원 운영업"},{"code":"87292","name":"종합복지관 운영업"},{"code":"87293","name":"방문 복지서비스 제공업"},{"code":"87294","name":"사회복지 상담서비스 제공업"},{"code":"87299","name":"그 외 기타 비거주 복지 서비스업"},{"code":"90110","name":"공연시설 운영업"},{"code":"90121","name":"연극단체"},{"code":"90122","name":"무용 및 음악단체"},{"code":"90123","name":"기타 공연단체"},{"code":"90131","name":"공연 예술가"},{"code":"90132","name":"비공연 예술가"},{"code":"90191","name":"공연 기획업"},{"code":"90192","name":"공연 및 제작관련 대리업"},{"code":"90199","name":"그 외 기타 창작 및 예술관련 서비스업"},{"code":"90211","name":"도서관 및 기록보존소 운영업"},{"code":"90212","name":"독서실 운영업"},{"code":"90221","name":"박물관 운영업"},{"code":"90222","name":"사적지 관리 운영업"},{"code":"90231","name":"식물원 및 동물원 운영업"},{"code":"90232","name":"자연공원 운영업"},{"code":"90290","name":"기타 유사 여가관련 서비스업"},{"code":"91111","name":"실내 경기장 운영업"},{"code":"91112","name":"실외 경기장 운영업"},{"code":"91113","name":"경주장 및 동물 경기장 운영업"},{"code":"91121","name":"골프장 운영업"},{"code":"91122","name":"스키장 운영업"},{"code":"91131","name":"종합 스포츠시설 운영업"},{"code":"91132","name":"체력단련시설 운영업"},{"code":"91133","name":"수영장 운영업"},{"code":"91134","name":"볼링장 운영업"},{"code":"91135","name":"당구장 운영업"},{"code":"91136","name":"골프연습장 운영업"},{"code":"91139","name":"그 외 기타 스포츠시설 운영업"},{"code":"91191","name":"스포츠 클럽 운영업"},{"code":"91199","name":"그 외 기타 스포츠 서비스업"},{"code":"91210","name":"유원지 및 테마파크 운영업"},{"code":"91221","name":"전자 게임장 운영업"},{"code":"91222","name":"컴퓨터 게임방 운영업"},{"code":"91223","name":"노래연습장 운영업"},{"code":"91229","name":"기타 오락장 운영업"},{"code":"91231","name":"낚시장 운영업"},{"code":"91239","name":"기타 수상오락 서비스업"},{"code":"91241","name":"복권발행 및 판매업"},{"code":"91242","name":"카지노 운영업"},{"code":"91249","name":"기타 사행시설 관리 및 운영업"},{"code":"91291","name":"무도장 운영업"},{"code":"91292","name":"체육공원 및 유사 공원 운영업"},{"code":"91293","name":"기원 운영업"},{"code":"91299","name":"그 외 기타 분류 안된 오락관련 서비스업"},{"code":"94110","name":"산업 단체"},{"code":"94120","name":"전문가 단체"},{"code":"94200","name":"노동조합"},{"code":"94911","name":"불교 단체"},{"code":"94912","name":"기독교 단체"},{"code":"94913","name":"천주교 단체"},{"code":"94914","name":"민족종교 단체"},{"code":"94919","name":"기타 종교 단체"},{"code":"94920","name":"정치 단체"},{"code":"94931","name":"환경운동 단체"},{"code":"94939","name":"기타 시민운동 단체"},{"code":"94990","name":"그 외 기타 협회 및 단체"},{"code":"95110","name":"컴퓨터 및 주변 기기 수리업"},{"code":"95120","name":"통신장비 수리업"},{"code":"95211","name":"자동차 종합 수리업"},{"code":"95212","name":"자동차 전문 수리업"},{"code":"95213","name":"자동차 세차업"},{"code":"95220","name":"모터사이클 수리업"},{"code":"95310","name":"가전제품 수리업"},{"code":"95391","name":"의복 및 기타 가정용 직물제품 수리업"},{"code":"95392","name":"가죽, 가방 및 신발 수리업"},{"code":"95393","name":"시계, 귀금속 및 악기 수리업"},{"code":"95399","name":"그 외 기타 개인 및 가정용품 수리업"},{"code":"96111","name":"이용업"},{"code":"96112","name":"두발 미용업"},{"code":"96113","name":"피부 미용업"},{"code":"96119","name":"기타 미용업"},{"code":"96121","name":"욕탕업"},{"code":"96122","name":"마사지업"},{"code":"96129","name":"체형 등 기타 신체관리 서비스업"},{"code":"96911","name":"산업용 세탁업"},{"code":"96912","name":"가정용 세탁업"},{"code":"96913","name":"세탁물 공급업"},{"code":"96921","name":"장례식장 및 장의관련 서비스업"},{"code":"96922","name":"화장터 운영, 묘지 분양 및 관리업"},{"code":"96991","name":"예식장업"},{"code":"96992","name":"점술 및 유사 서비스업"},{"code":"96993","name":"개인 간병 및 유사 서비스업"},{"code":"96994","name":"결혼 상담 및 준비 서비스업"},{"code":"96995","name":"반려동물 장묘 및 보호 서비스업"},{"code":"96999","name":"그 외 기타 달리 분류되지 않은 개인 서비스업"},{"code":"97000","name":"가구 내 고용활동"},{"code":"98100","name":"자가 소비를 위한 가사 생산 활동"},{"code":"98200","name":"자가 소비를 위한 가사 서비스 활동"},{"code":"99001","name":"주한 외국공관"},{"code":"99009","name":"기타 국제 및 외국기관"}];
    return ksicData;
  });

// ============================================================
// 11. changeUserPassword - 관리자용 회원 비밀번호 변경
// ============================================================
exports.changeUserPassword = functions
  .region('asia-northeast3')
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onCall(async (data, context) => {
    try {
      const { uid, newPassword, adminSecret } = data;
      
      // 관리자 비밀키 검증
      if (adminSecret !== 'finmaster-admin-2024') {
        throw new functions.https.HttpsError('permission-denied', '관리자 권한이 없습니다.');
      }
      
      // 필수 파라미터 체크
      if (!uid || !newPassword) {
        throw new functions.https.HttpsError('invalid-argument', 'uid와 newPassword가 필요합니다.');
      }
      
      // 비밀번호 길이 체크
      if (newPassword.length < 6) {
        throw new functions.https.HttpsError('invalid-argument', '비밀번호는 6자 이상이어야 합니다.');
      }
      
      // Firebase Auth 비밀번호 변경
      await admin.auth().updateUser(uid, {
        password: newPassword
      });
      
      // Firestore에도 업데이트 (관리자 조회용)
      await db.collection('users').doc(uid).update({
        password: newPassword,
        isPasswordChanged: true,
        passwordUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      console.log(`✅ 비밀번호 변경 완료: ${uid}`);
      
      return { success: true, message: '비밀번호가 변경되었습니다.' };
      
    } catch (error) {
      console.error('❌ 비밀번호 변경 오류:', error);
      throw new functions.https.HttpsError('internal', error.message);
    }
  });

// ============================================================
// 12. chargePoints - 포인트 충전 (INNOPAY 결제 완료 후)
// ============================================================
exports.chargePoints = functions
  .region('asia-northeast3')
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {
    try {
      // 인증 확인
      if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', '로그인이 필요합니다.');
      }
      
      const userId = context.auth.uid;
      const userEmail = context.auth.token.email || '';
      const { amount, tid, moid, authCode } = data;
      
      // 필수 파라미터 검증
      if (!amount || !tid || !moid) {
        throw new functions.https.HttpsError('invalid-argument', '필수 정보가 누락되었습니다.');
      }
      
      // 금액 범위 검증 (1만원 ~ 100만원)
      if (amount < 10000 || amount > 1000000) {
        throw new functions.https.HttpsError('invalid-argument', '충전 금액은 1만원 ~ 100만원 사이여야 합니다.');
      }
      
      // 1000원 단위 검증
      if (amount % 1000 !== 0) {
        throw new functions.https.HttpsError('invalid-argument', '충전 금액은 1,000원 단위여야 합니다.');
      }
      
      const db = admin.firestore();
      
      // 중복 결제 방지 - 동일 tid로 이미 처리된 건인지 확인
      const existingPayment = await db.collection('payments')
        .where('tid', '==', tid)
        .limit(1)
        .get();
      
      if (!existingPayment.empty) {
        console.log(`⚠️ 중복 결제 요청 감지: ${tid}`);
        const existingData = existingPayment.docs[0].data();
        return { 
          success: true, 
          message: '이미 처리된 결제입니다.',
          newBalance: existingData.balanceAfter,
          duplicate: true
        };
      }
      
      // 트랜잭션으로 포인트 적립 처리
      const result = await db.runTransaction(async (transaction) => {
        // 사용자 크레딧 문서 조회 (users 컬렉션 - getCredits와 동일)
        const userRef = db.collection('users').doc(userId);
        const userDoc = await transaction.get(userRef);
        
        let currentBalance = 0;
        if (userDoc.exists) {
          currentBalance = userDoc.data().paidBalance || 0;
        }
        
        const newBalance = currentBalance + amount;
        
        // 크레딧 업데이트
        if (userDoc.exists) {
          transaction.update(userRef, {
            paidBalance: newBalance,
            lastChargeAt: admin.firestore.FieldValue.serverTimestamp()
          });
        } else {
          // 문서가 없으면 새로 생성
          const currentMonth = new Date().toISOString().slice(0, 7);
          transaction.set(userRef, {
            freeRemaining: 10,
            paidBalance: newBalance,
            lastResetMonth: currentMonth,
            lastChargeAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }
        
        // 결제 기록 저장
        const paymentRef = db.collection('payments').doc();
        transaction.set(paymentRef, {
          uid: userId,
          email: userEmail,
          type: 'point_charge',
          amount: amount,
          points: amount,  // 1:1 적립
          tid: tid,
          moid: moid,
          authCode: authCode || '',
          status: 'success',
          balanceBefore: currentBalance,
          balanceAfter: newBalance,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        // 포인트 로그 저장
        const logRef = db.collection('pointLogs').doc();
        transaction.set(logRef, {
          uid: userId,
          email: userEmail,
          type: 'charge',
          amount: amount,
          description: `포인트 충전 (${amount.toLocaleString()}원)`,
          balanceBefore: currentBalance,
          balanceAfter: newBalance,
          paymentId: paymentRef.id,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        return { newBalance, paymentId: paymentRef.id };
      });
      
      console.log(`✅ 포인트 충전 완료: ${userId}, +${amount}P, 잔액: ${result.newBalance}P`);
      
      return {
        success: true,
        message: '포인트가 충전되었습니다.',
        chargedAmount: amount,
        chargedPoints: amount,
        newBalance: result.newBalance,
        paymentId: result.paymentId
      };
      
    } catch (error) {
      console.error('❌ 포인트 충전 오류:', error);
      
      if (error instanceof functions.https.HttpsError) {
        throw error;
      }
      
      throw new functions.https.HttpsError('internal', '포인트 충전 중 오류가 발생했습니다.');
    }
  });

// ============================================================
// 13. approvePayment - INNOPAY 결제 승인 및 포인트 적립
// ============================================================
const INNOPAY_CONFIG = {
  MID: 'pgkfpcen5m',
  MERCHANT_KEY: 'c/odh029sWya/US4LINs89lb/8PD0qlbZjEkckW5L3toSMCpD4TQ8IWquueuKFpZm8XY/mVuxrsygQD9P9CooQ==',
  APPROVE_URL: 'https://api.innopay.co.kr/v1/transactions/pay'
};

exports.approvePayment = functions
  .region('asia-northeast3')
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {
    try {
      // 인증 확인
      if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', '로그인이 필요합니다.');
      }
      
      const { paymentToken, tid, mid, amt, moid } = data;
      
      // 필수 파라미터 확인
      if (!paymentToken || !tid || !amt || !moid) {
        throw new functions.https.HttpsError('invalid-argument', '필수 결제 정보가 누락되었습니다.');
      }
      
      const userId = context.auth.uid;
      const userEmail = context.auth.token.email || '';
      const amount = parseInt(amt);
      
      console.log('💳 결제 승인 요청:', { userId, tid, moid, amount });
      
      const db = admin.firestore();
      
      // 중복 결제 방지 - 동일 tid로 이미 처리된 건인지 확인
      const existingPayment = await db.collection('payments')
        .where('tid', '==', tid)
        .limit(1)
        .get();
      
      if (!existingPayment.empty) {
        console.log(`⚠️ 중복 결제 요청 감지: ${tid}`);
        const existingData = existingPayment.docs[0].data();
        return { 
          success: true, 
          message: '이미 처리된 결제입니다.',
          newBalance: existingData.balanceAfter,
          duplicate: true
        };
      }
      
      // 1. INNOPAY 승인 API 호출
      const approveResponse = await fetch(INNOPAY_CONFIG.APPROVE_URL, {
        method: 'POST',
        headers: {
          'Payment-Token': paymentToken,
          'Merchant-Key': INNOPAY_CONFIG.MERCHANT_KEY,
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({
          tid: tid,
          mid: mid || INNOPAY_CONFIG.MID,
          amt: String(amount),
          taxFreeAmt: String(amount),
          moid: moid
        })
      });
      
      const approveResult = await approveResponse.json();
      console.log('💳 INNOPAY 승인 결과:', approveResult);
      
      // 승인 실패 체크
      if (!approveResult.success && approveResult.resultCode !== '0000') {
        console.error('❌ INNOPAY 승인 실패:', approveResult);
        return {
          success: false,
          message: approveResult.resultMsg || '결제 승인에 실패했습니다.'
        };
      }
      
      // 2. 트랜잭션으로 포인트 적립 처리
      const result = await db.runTransaction(async (transaction) => {
        // 사용자 크레딧 문서 조회 (users 컬렉션 - getCredits와 동일)
        const userRef = db.collection('users').doc(userId);
        const userDoc = await transaction.get(userRef);
        
        let currentBalance = 0;
        if (userDoc.exists) {
          currentBalance = userDoc.data().paidBalance || 0;
        }
        
        const newBalance = currentBalance + amount;
        
        // 크레딧 업데이트
        if (userDoc.exists) {
          transaction.update(userRef, {
            paidBalance: newBalance,
            lastChargeAt: admin.firestore.FieldValue.serverTimestamp()
          });
        } else {
          // 문서가 없으면 새로 생성
          const currentMonth = new Date().toISOString().slice(0, 7);
          transaction.set(userRef, {
            freeRemaining: 10,
            paidBalance: newBalance,
            lastResetMonth: currentMonth,
            lastChargeAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }
        
        // 결제 기록 저장
        const paymentRef = db.collection('payments').doc();
        transaction.set(paymentRef, {
          uid: userId,
          email: userEmail,
          type: 'point_charge',
          amount: amount,
          points: amount,
          tid: tid,
          moid: moid,
          authCode: approveResult.authCode || '',
          cardNum: approveResult.cardNum || '',
          cardName: approveResult.appCardName || '',
          status: 'success',
          balanceBefore: currentBalance,
          balanceAfter: newBalance,
          innopayResponse: approveResult,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        // 포인트 로그 저장
        const logRef = db.collection('pointLogs').doc();
        transaction.set(logRef, {
          uid: userId,
          email: userEmail,
          type: 'charge',
          amount: amount,
          description: `포인트 충전 (${amount.toLocaleString()}원)`,
          balanceBefore: currentBalance,
          balanceAfter: newBalance,
          paymentId: paymentRef.id,
          tid: tid,
          moid: moid,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        return { newBalance, paymentId: paymentRef.id };
      });
      
      console.log(`✅ 결제 승인 및 포인트 충전 완료: ${userId}, +${amount}P, 잔액: ${result.newBalance}P`);
      
      return {
        success: true,
        message: '포인트가 충전되었습니다.',
        chargedAmount: amount,
        newBalance: result.newBalance,
        paymentId: result.paymentId
      };
      
    } catch (error) {
      console.error('❌ 결제 승인 오류:', error);
      
      if (error instanceof functions.https.HttpsError) {
        throw error;
      }
      
      throw new functions.https.HttpsError('internal', '결제 처리 중 오류가 발생했습니다.');
    }
  });
