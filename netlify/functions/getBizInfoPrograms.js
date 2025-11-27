/**
 * 기업마당 API 연동 - 실제 지원사업 공고 데이터 가져오기
 * 
 * API URL: https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do
 */

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8'
  };

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // 환경변수에서 API 키 가져오기
    const BIZINFO_API_KEY = process.env.BIZINFO_API_KEY;
    
    if (!BIZINFO_API_KEY) {
      throw new Error('BIZINFO_API_KEY 환경변수가 설정되지 않았습니다.');
    }

    // 요청 파라미터 파싱
    let params = {};
    if (event.httpMethod === 'POST' && event.body) {
      params = JSON.parse(event.body);
    } else if (event.queryStringParameters) {
      params = event.queryStringParameters;
    }

    const {
      category = '',
      region = '',
      searchCnt = '500',
      pageUnit = '100',
      pageIndex = '1'
    } = params;

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

    // Node.js 18+ 내장 fetch 사용
    const response = await fetch(apiUrl);

    if (!response.ok) {
      throw new Error(`기업마당 API 오류: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    console.log('📥 응답 길이:', text.length);
    
    // JSON 파싱 시도
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      console.error('JSON 파싱 실패, 응답 시작:', text.substring(0, 200));
      throw new Error('기업마당 API 응답이 JSON 형식이 아닙니다.');
    }

    // 응답 데이터 파싱
    // 기업마당 API 응답 구조: { jsonArray: { item: [...] } }
    let programs = [];

    if (data && data.jsonArray && data.jsonArray.item) {
      // 올바른 구조: jsonArray.item 배열
      programs = Array.isArray(data.jsonArray.item) ? data.jsonArray.item : [data.jsonArray.item];
      console.log('📦 jsonArray.item 구조 확인');
    } else if (data && data.jsonArray && Array.isArray(data.jsonArray)) {
      // jsonArray가 배열인 경우
      programs = data.jsonArray;
      console.log('📦 jsonArray 배열 구조 확인');
    } else if (data && Array.isArray(data)) {
      programs = data;
      console.log('📦 배열 구조 확인');
    } else if (data && data.items) {
      programs = data.items;
      console.log('📦 items 구조 확인');
    } else {
      console.log('⚠️ 알 수 없는 응답 구조:', Object.keys(data || {}));
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
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        totalCount: normalizedPrograms.length,
        stats: stats,
        programs: normalizedPrograms,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('❌ 기업마당 API 오류:', error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message,
        programs: [],
        timestamp: new Date().toISOString()
      })
    };
  }
};
