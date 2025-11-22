/**
 * Netlify Function: 벤처기업 인증 조회 (하이브리드)
 * 경로: /.netlify/functions/getVenture
 * 
 * 전략:
 * 1단계: 공공데이터 API (빠름)
 * 2단계: 공식 사이트 크롤링 (정확함)
 * 
 * 출처:
 * - API: 공공데이터포털
 * - Web: 중소벤처기업부 벤처확인포털
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

    console.log(`🚀 벤처인증 조회 시작: ${companyName || businessNumber}`);

    // ===== 1단계: 공공데이터 API 시도 =====
    const API_KEY = process.env.API_KEY;
    
    if (API_KEY) {
      try {
        console.log('  → 1단계: 공공데이터 API 시도...');
        
        const apiResponse = await fetch(
          `https://api.odcloud.kr/api/15084581/v1/uddi:41944402-8249-4e45-9e9d-a03027ccf595?serviceKey=${API_KEY}&page=1&perPage=100`,
          {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
          }
        );

        if (apiResponse.ok) {
          const result = await apiResponse.json();
          
          if (result.data && result.data.length > 0) {
            let venture = null;
            
            // 회사명으로 검색
            if (companyName) {
              venture = result.data.find(item => 
                item['기업명'] && item['기업명'].includes(companyName)
              );
            }
            
            // 사업자번호로 검색
            if (!venture && businessNumber) {
              const cleanBN = businessNumber.replace(/-/g, '');
              venture = result.data.find(item => 
                item['사업자등록번호'] && item['사업자등록번호'].replace(/-/g, '') === cleanBN
              );
            }

            if (venture && venture['벤처유효기간 종료일']) {
              const today = new Date();
              const endDate = venture['벤처유효기간 종료일'];
              const expiryDate = new Date(endDate);
              const isValid = expiryDate > today;

              console.log(`✅ API 조회 성공: ${venture['기업명']}`);

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
                  category: venture['벤처구분'],
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

    console.log(`❌ 조회 실패: 벤처인증 없음 (API 실패)`);

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
    console.error('❌ 벤처인증 조회 오류:', error);
    
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
