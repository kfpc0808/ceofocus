/**
 * Netlify Function: 메인비즈 API 호출
 * 경로: /.netlify/functions/getMainbiz
 * 
 * 메인비즈 공식 웹사이트에서 기업 정보 조회
 * https://www.smes.go.kr/mainbiz/usr/innovation/list.do
 */

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  // CORS 헤더 설정
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // OPTIONS 요청 처리 (CORS preflight)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  // POST 요청만 허용
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    // 요청 데이터 파싱
    const { companyName, businessNumber } = JSON.parse(event.body);

    if (!companyName && !businessNumber) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          message: '회사명 또는 사업자번호가 필요합니다.' 
        })
      };
    }

    console.log(`메인비즈 API 호출: ${companyName || businessNumber}`);

    // 검색어 설정 (사업자번호 우선, 없으면 회사명)
    const searchKeyword = businessNumber 
      ? businessNumber.replace(/-/g, '') // 사업자번호에서 하이픈 제거
      : companyName;

    // 메인비즈 웹사이트에서 데이터 조회
    // POST 방식으로 검색
    const searchUrl = 'https://www.smes.go.kr/mainbiz/usr/innovation/list.do';
    
    const formData = new URLSearchParams();
    formData.append('searchKeyword', searchKeyword);
    formData.append('pageIndex', '1');
    formData.append('pageUnit', '10');

    const response = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: formData.toString()
    });

    const html = await response.text();

    // HTML 파싱 (간단한 정규식 사용)
    const parseMainbizData = (htmlText) => {
      const results = [];
      
      // 테이블 행 추출
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      const matches = htmlText.matchAll(rowRegex);
      
      for (const match of matches) {
        const rowHtml = match[1];
        
        // 각 셀 데이터 추출
        const getCell = (label) => {
          const regex = new RegExp(`${label}[\\s\\S]*?(?:<[^>]+>)*([^<]+)`, 'i');
          const cellMatch = rowHtml.match(regex);
          return cellMatch ? cellMatch[1].trim() : '';
        };
        
        // 업체명 추출 (여러 패턴 시도)
        let companyNameValue = '';
        const companyPatterns = [
          /업체명[^<]*<[^>]+>([^<]+)/i,
          /업체명[\s\S]*?<td[^>]*>([^<]+)/i,
          /<td[^>]*class="[^"]*company[^"]*"[^>]*>([^<]+)/i
        ];
        
        for (const pattern of companyPatterns) {
          const match = rowHtml.match(pattern);
          if (match && match[1].trim()) {
            companyNameValue = match[1].trim();
            break;
          }
        }
        
        if (!companyNameValue) continue;
        
        // 지역 추출
        const regionMatch = rowHtml.match(/지역[^<]*<[^>]+>([^<]+)/i);
        const region = regionMatch ? regionMatch[1].trim() : '';
        
        // 대표자명 추출
        const ceoMatch = rowHtml.match(/대표자명[^<]*<[^>]+>([^<]+)/i);
        const ceo = ceoMatch ? ceoMatch[1].trim() : '';
        
        // 인증만료일 추출
        const expireDateMatch = rowHtml.match(/인증만료일[^<]*<[^>]+>(\d{4}-\d{2}-\d{2})/i);
        const expireDate = expireDateMatch ? expireDateMatch[1] : '';
        
        // 업종 추출
        const industryMatch = rowHtml.match(/업종[^<]*<[^>]+>([^<]+)/i);
        const industry = industryMatch ? industryMatch[1].trim() : '';
        
        if (companyNameValue && expireDate) {
          results.push({
            companyName: companyNameValue,
            region: region,
            ceo: ceo,
            industry: industry,
            expireDate: expireDate
          });
        }
      }
      
      return results;
    };

    const mainbizList = parseMainbizData(html);

    if (mainbizList.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: false,
          message: '메인비즈 인증 정보를 찾을 수 없습니다.'
        })
      };
    }

    // 검색어와 가장 일치하는 결과 찾기
    let bestMatch = mainbizList[0];
    
    if (companyName) {
      // 회사명으로 검색한 경우, 가장 유사한 결과 찾기
      for (const item of mainbizList) {
        if (item.companyName.includes(companyName) || companyName.includes(item.companyName)) {
          bestMatch = item;
          break;
        }
      }
    }

    // 유효기간 확인
    const today = new Date();
    const expireDate = new Date(bestMatch.expireDate);
    const isValid = expireDate > today;

    console.log(`메인비즈 검색 완료: ${bestMatch.companyName}, 유효: ${isValid}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        isValid: isValid,
        companyName: bestMatch.companyName,
        region: bestMatch.region,
        ceo: bestMatch.ceo,
        industry: bestMatch.industry,
        endDate: bestMatch.expireDate,
        message: isValid ? '메인비즈 인증 유효' : '메인비즈 인증 만료'
      })
    };

  } catch (error) {
    console.error('메인비즈 API 오류:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        message: '메인비즈 정보 조회 중 오류가 발생했습니다: ' + error.message
      })
    };
  }
};
