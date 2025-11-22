/**
 * Netlify Function: 이노비즈 인증 조회 (하이브리드)
 * 경로: /.netlify/functions/getInnobiz
 * 
 * 전략:
 * 1차: 공공데이터 API (빠름)
 * 2차: 공식 사이트 크롤링 (정확함)
 * 
 * 역할:
 * - 최신 만료일 정보 제공
 * - 안정성과 정확성 모두 확보
 */

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    const { companyName } = JSON.parse(event.body);

    if (!companyName) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          message: '회사명을 입력해주세요.' 
        })
      };
    }

    console.log(`💡 이노비즈 조회 시작: ${companyName}`);

    // ===== 1단계: 공공데이터 API 시도 =====
    const API_KEY = process.env.API_KEY;
    
    if (API_KEY) {
      try {
        console.log('  → 1단계: 공공데이터 API 시도...');
        
        const apiResponse = await fetch(
          `https://api.odcloud.kr/api/15134641/v1/uddi:56633b5d-548b-45e5-a295-f0b0b1933c0f?serviceKey=${API_KEY}&page=1&perPage=100`,
          {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
          }
        );

        if (apiResponse.ok) {
          const result = await apiResponse.json();
          
          if (result.data && result.data.length > 0) {
            const innobiz = result.data.find(item => 
              item['회사명'] && item['회사명'].includes(companyName)
            );

            if (innobiz && innobiz['이노비즈 유효기간 종료일']) {
              const today = new Date();
              const endDate = innobiz['이노비즈 유효기간 종료일'];
              const expiryDate = new Date(endDate);
              const isValid = expiryDate > today;

              console.log(`✅ API 조회 성공: ${innobiz['회사명']}`);

              return {
                statusCode: 200,
                headers: {
                  'Access-Control-Allow-Origin': '*',
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  success: true,
                  companyName: innobiz['회사명'],
                  ceo: innobiz['대표자명'] || '',
                  region: innobiz['지역'] || '',
                  products: innobiz['주 생산품'] || '',
                  startDate: innobiz['이노비즈 유효기간 시작일'] || '',
                  endDate: endDate,
                  website: innobiz['홈페이지 주소'] || '',
                  isValid: isValid,
                  source: 'API (공공데이터포털)'
                })
              };
            }
          }
        }
        
        console.log('  → API 조회 실패 또는 데이터 없음');
      } catch (apiError) {
        console.log('  → API 오류:', apiError.message);
      }
    }

    // ===== 2단계: 공식 사이트 크롤링 =====
    console.log('  → 2단계: 공식 사이트 크롤링 시도...');
    
    const searchUrl = 'https://www.innobiz.net/company/company2_list.asp';
    
    const webResponse = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8'
      },
      body: `searchword=${encodeURIComponent(companyName)}&searchtype=company`
    });

    if (!webResponse.ok) {
      throw new Error(`크롤링 실패: ${webResponse.status}`);
    }

    const html = await webResponse.text();

    // HTML 파싱
    const companyPattern = new RegExp(`<td[^>]*>\\s*${companyName}[^<]*<\\/td>`, 'i');
    const companyMatch = html.match(companyPattern);
    
    if (companyMatch) {
      const rowStart = html.indexOf(companyMatch[0]) - 500;
      const rowEnd = html.indexOf(companyMatch[0]) + 1000;
      const rowHtml = html.substring(Math.max(0, rowStart), rowEnd);
      
      // 데이터 추출
      const ceoMatch = rowHtml.match(/<td[^>]*>([가-힣]{2,4})<\/td>/);
      const regionMatch = rowHtml.match(/<td[^>]*>([가-힣]+[시도])<\/td>/);
      const productsMatch = rowHtml.match(/<td[^>]*>([^<]{5,})<\/td>/);
      
      // 날짜 추출
      const datePattern = /(\d{4})[.-](\d{2})[.-](\d{2})/g;
      const dates = rowHtml.match(datePattern);
      
      let startDate = '';
      let endDate = '';
      let isValid = false;
      
      if (dates && dates.length >= 2) {
        startDate = dates[0].replace(/\./g, '-');
        endDate = dates[1].replace(/\./g, '-');
        
        const today = new Date();
        const expiryDate = new Date(endDate);
        isValid = expiryDate > today;
      }

      console.log(`✅ 크롤링 조회 성공: ${companyName}`);
      console.log(`   만료일: ${endDate} (${isValid ? '유효' : '만료'})`);

      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          success: true,
          companyName: companyName,
          ceo: ceoMatch ? ceoMatch[1] : '',
          region: regionMatch ? regionMatch[1] : '',
          products: productsMatch ? productsMatch[1].trim() : '',
          startDate: startDate,
          endDate: endDate,
          isValid: isValid,
          source: 'Web Crawling (innobiz.net 공식)'
        })
      };
    }

    console.log(`❌ 조회 실패: 이노비즈 인증 없음 (API + 크롤링 모두 실패)`);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        success: false, 
        message: '이노비즈 인증 정보 없음' 
      })
    };

  } catch (error) {
    console.error('❌ 이노비즈 조회 오류:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        success: false, 
        message: '조회 실패: ' + error.message 
      })
    };
  }
};
