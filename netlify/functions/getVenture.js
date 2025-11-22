/**
 * Netlify Function: 벤처기업 인증 조회 API 프록시
 * 경로: /.netlify/functions/getVenture
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
    const { companyName, businessNumber } = JSON.parse(event.body);

    if (!companyName && !businessNumber) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          message: '회사명 또는 사업자번호를 입력해주세요.' 
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

    console.log(`🚀 벤처인증 API 조회: ${companyName || businessNumber}`);

    // 벤처인증 API 호출
    const response = await fetch(
      `https://api.odcloud.kr/api/15084581/v1/uddi:41944402-8249-4e45-9e9d-a03027ccf595?serviceKey=${API_KEY}&page=1&perPage=100`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      }
    );

    const result = await response.json();

    if (result.data && result.data.length > 0) {
      // 회사명 또는 사업자번호로 검색
      let venture = null;
      
      if (companyName) {
        venture = result.data.find(item => 
          item['기업명'] && item['기업명'].includes(companyName)
        );
      }
      
      if (!venture && businessNumber) {
        const cleanBN = businessNumber.replace(/-/g, '');
        venture = result.data.find(item => 
          item['사업자등록번호'] && item['사업자등록번호'].replace(/-/g, '') === cleanBN
        );
      }

      if (venture) {
        // 유효기간 확인
        const today = new Date();
        const endDate = venture['벤처유효기간 종료일'];
        let isValid = false;
        
        if (endDate) {
          const expiryDate = new Date(endDate);
          isValid = expiryDate > today;
        }

        console.log(`✅ 조회 성공: ${venture['기업명']} (${isValid ? '유효' : '만료'})`);

        return {
          statusCode: 200,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            success: true,
            companyName: venture['기업명'],
            businessNumber: venture['사업자등록번호'],
            region: venture['지역'],
            startDate: venture['벤처유효기간 시작일'],
            endDate: endDate,
            isValid: isValid,
            category: venture['벤처구분']
          })
        };
      }
    }

    console.log(`❌ 조회 실패: 벤처인증 없음`);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        success: false, 
        message: '벤처인증 정보 없음' 
      })
    };

  } catch (error) {
    console.error('❌ 벤처인증 API 오류:', error);
    
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
