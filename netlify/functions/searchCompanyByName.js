/**
 * 기업명으로 사업자 검색
 * 국세청 사업자등록정보 진위확인 API 활용
 */

exports.handler = async (event, context) => {
  // CORS 헤더
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // OPTIONS 요청 처리
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // POST만 허용
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    const { companyName } = JSON.parse(event.body);

    if (!companyName || companyName.trim().length < 2) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          message: '기업명은 최소 2글자 이상 입력해주세요.'
        })
      };
    }

    console.log(`🔍 기업명 검색: ${companyName}`);

    // 국세청 API 키 (환경변수에서)
    const NTS_API_KEY = process.env.NTS_API_KEY || process.env.BIZINFO_API_KEY;

    if (!NTS_API_KEY) {
      console.error('❌ API 키가 설정되지 않았습니다');
      
      // API 키 없을 때 MOCK 데이터 반환 (개발용)
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          companies: generateMockCompanies(companyName),
          isMock: true
        })
      };
    }

    // 실제 API 호출은 여기에 구현
    // 현재는 MOCK 데이터 반환
    const companies = generateMockCompanies(companyName);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        companies,
        count: companies.length
      })
    };

  } catch (error) {
    console.error('❌ 검색 오류:', error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        message: '검색 중 오류가 발생했습니다.',
        error: error.message
      })
    };
  }
};

/**
 * Mock 데이터 생성 (개발/테스트용)
 */
function generateMockCompanies(query) {
  const mockDatabase = [
    { name: '삼성전자', bizNo: '124-81-00998', status: '계속사업자', address: '경기도 수원시' },
    { name: '삼성물산', bizNo: '106-81-13238', status: '계속사업자', address: '서울특별시 강남구' },
    { name: '삼성생명', bizNo: '229-81-00010', status: '계속사업자', address: '서울특별시 서초구' },
    { name: '삼성화재', bizNo: '105-81-00197', status: '계속사업자', address: '서울특별시 서초구' },
    { name: 'LG전자', bizNo: '107-86-14075', status: '계속사업자', address: '서울특별시 영등포구' },
    { name: 'LG화학', bizNo: '104-81-06206', status: '계속사업자', address: '서울특별시 영등포구' },
    { name: 'SK하이닉스', bizNo: '124-81-13718', status: '계속사업자', address: '경기도 성남시' },
    { name: '현대자동차', bizNo: '114-81-02606', status: '계속사업자', address: '서울특별시 서초구' },
    { name: '네이버', bizNo: '220-81-62517', status: '계속사업자', address: '경기도 성남시' },
    { name: '카카오', bizNo: '120-81-47521', status: '계속사업자', address: '제주특별자치도' },
    { name: '중소기업A', bizNo: '123-45-67890', status: '계속사업자', address: '서울특별시 강남구' },
    { name: '스타트업B', bizNo: '234-56-78901', status: '계속사업자', address: '서울특별시 서초구' },
    { name: '벤처기업C', bizNo: '345-67-89012', status: '계속사업자', address: '경기도 용인시' }
  ];

  // 검색어로 필터링
  const filtered = mockDatabase.filter(company => 
    company.name.toLowerCase().includes(query.toLowerCase())
  );

  // 최대 10개만 반환
  return filtered.slice(0, 10);
}
