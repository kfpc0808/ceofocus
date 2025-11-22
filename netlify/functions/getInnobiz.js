/**
 * Netlify Function: 이노비즈 인증 조회 API 프록시
 * 경로: /.netlify/functions/getInnobiz
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

    const API_KEY = process.env.API_KEY;

    if (!API_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          success: false, 
          message: 'API Key가 설정되지 않았습니다.' 
        })
      };
    }

    console.log(`💡 이노비즈 API 조회: ${companyName}`);

    // 이노비즈 API 호출
    const response = await fetch(
      `https://api.odcloud.kr/api/15134641/v1/uddi:56633b5d-548b-45e5-a295-f0b0b1933c0f?serviceKey=${API_KEY}&page=1&perPage=100`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      }
    );

    const result = await response.json();

    if (result.data && result.data.length > 0) {
      // 회사명으로 검색
      const innobiz = result.data.find(item => 
        item['회사명'] && item['회사명'].includes(companyName)
      );

      if (innobiz) {
        // 유효기간 확인
        const today = new Date();
        const endDate = innobiz['이노비즈 유효기간 종료일'];
        let isValid = false;
        
        if (endDate) {
          const expiryDate = new Date(endDate);
          isValid = expiryDate > today;
        }

        console.log(`✅ 조회 성공: ${innobiz['회사명']} (${isValid ? '유효' : '만료'})`);

        return {
          statusCode: 200,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            success: true,
            companyName: innobiz['회사명'],
            ceo: innobiz['대표자명'],
            region: innobiz['지역'],
            products: innobiz['주 생산품'],
            startDate: innobiz['이노비즈 유효기간 시작일'],
            endDate: endDate,
            website: innobiz['홈페이지 주소'],
            isValid: isValid
          })
        };
      }
    }

    console.log(`❌ 조회 실패: 이노비즈 인증 없음`);

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
    console.error('❌ 이노비즈 API 오류:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        success: false, 
        message: 'API 호출 실패: ' + error.message 
      })
    };
  }
};
