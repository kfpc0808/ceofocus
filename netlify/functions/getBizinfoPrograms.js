/**
 * 기업마당 API 연동 - 실제 지원사업 공고 데이터 가져오기
 * 
 * API URL: https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do
 * 
 * 제공 정보:
 * - pblancNm: 공고명
 * - pblancId: 공고ID
 * - pblancUrl: 공고URL
 * - jrsdInsttNm: 소관기관명
 * - excInsttNm: 수행기관명
 * - bsnsSumryCn: 사업개요내용
 * - reqstMthPapersCn: 사업신청방법
 * - trgetNm: 지원대상
 * - pldirSportRealmLclasCodeNm: 지원분야 대분류
 * - reqstBeginEndDe: 신청기간
 * - hashTags: 해시태그
 * - flpthNm: 첨부파일경로 (PDF 공고문)
 * - fileNm: 첨부파일명
 */

const fetch = require('node-fetch');

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
      category = '',      // 분야 코드 (01:금융, 02:기술, 03:인력, 04:수출, 05:내수, 06:창업, 07:경영, 09:기타)
      region = '',        // 지역 해시태그
      searchCnt = '500',  // 조회 건수 (기본 500개)
      pageUnit = '100',   // 페이지당 개수
      pageIndex = '1'     // 페이지 번호
    } = params;

    console.log('📡 기업마당 API 호출 시작...');
    console.log(`   - 분야: ${category || '전체'}`);
    console.log(`   - 지역: ${region || '전국'}`);
    console.log(`   - 조회건수: ${searchCnt}`);

    // 기업마당 API URL 구성
    let apiUrl = `https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do?crtfcKey=${BIZINFO_API_KEY}&dataType=json`;
    
    // 조회 건수 (전체 데이터)
    apiUrl += `&searchCnt=${searchCnt}`;
    
    // 분야 필터
    if (category) {
      apiUrl += `&searchLclasId=${category}`;
    }
    
    // 해시태그 (지역 등)
    if (region) {
      apiUrl += `&hashtags=${encodeURIComponent(region)}`;
    }
    
    // 페이징
    apiUrl += `&pageUnit=${pageUnit}&pageIndex=${pageIndex}`;

    console.log('🔗 API URL:', apiUrl.replace(BIZINFO_API_KEY, '***'));

    // API 호출
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Accept-Charset': 'utf-8'
      }
    });

    if (!response.ok) {
      throw new Error(`기업마당 API 오류: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // 응답 데이터 파싱
    let programs = [];
    let totalCount = 0;

    // JSON 응답 구조 확인 (기업마당 API는 jsonArray 형태로 반환)
    if (data && data.jsonArray) {
      programs = data.jsonArray;
      totalCount = programs.length;
    } else if (data && Array.isArray(data)) {
      programs = data;
      totalCount = programs.length;
    } else if (data && data.items) {
      programs = data.items;
      totalCount = data.totalCount || programs.length;
    }

    console.log(`✅ 기업마당 API 응답: ${totalCount}개 공고`);

    // 데이터 정규화 (필드명 통일)
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
      // 첨부파일 (PDF 공고문)
      attachmentUrl: item.flpthNm || '',
      attachmentName: item.fileNm || '',
      // 본문 출력 파일
      printFileUrl: item.printFlpthNm || '',
      printFileName: item.printFileNm || ''
    }));

    // 신청기간 파싱 (시작일, 종료일 분리)
    normalizedPrograms.forEach(program => {
      if (program.applicationPeriod) {
        const periods = program.applicationPeriod.split('~').map(s => s.trim());
        if (periods.length === 2) {
          program.applicationStart = periods[0];
          program.applicationEnd = periods[1];
          
          // 신청 가능 여부 확인
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
    console.log(`📊 신청 가능: ${stats.openCount}개`);

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
