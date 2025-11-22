/**
 * Netlify Function: 기업부설연구소 조회
 * 경로: /.netlify/functions/getResearchLab
 * 
 * 한국산업기술진흥협회(KOITA) 부설연구소 검색
 * https://www.rnd.or.kr/user/infoservice/search5.do
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

    console.log(`부설연구소 API 호출: ${companyName || businessNumber}`);

    // 검색어 설정 (회사명 우선, 없으면 사업자번호)
    const searchKeyword = companyName || businessNumber.replace(/-/g, '');

    // 부설연구소 검색 페이지 (GET 또는 POST 방식)
    // 실제 사이트 확인 후 방식 결정 필요
    const searchUrl = `https://www.rnd.or.kr/user/infoservice/search5.do`;
    
    // POST 방식 시도
    const formData = new URLSearchParams();
    formData.append('searchKeyword', searchKeyword);
    formData.append('pageIndex', '1');
    formData.append('pageUnit', '20');

    const response = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: formData.toString()
    });

    const html = await response.text();

    // HTML 파싱 함수
    const parseResearchLabData = (htmlText) => {
      const results = [];
      
      // 테이블 행 추출 (실제 HTML 구조에 맞춰 조정 필요)
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      const matches = htmlText.matchAll(rowRegex);
      
      for (const match of matches) {
        const rowHtml = match[1];
        
        // 기업명 추출 (여러 패턴 시도)
        let companyNameValue = '';
        const companyPatterns = [
          /기업명[^<]*<[^>]+>([^<]+)/i,
          /회사명[^<]*<[^>]+>([^<]+)/i,
          /<td[^>]*>([^<]*(?:주식회사|유한회사|\(주\))[^<]*)<\/td>/i
        ];
        
        for (const pattern of companyPatterns) {
          const companyMatch = rowHtml.match(pattern);
          if (companyMatch && companyMatch[1].trim()) {
            companyNameValue = companyMatch[1].trim();
            break;
          }
        }
        
        if (!companyNameValue) continue;
        
        // 연구소명 추출
        const labNameMatch = rowHtml.match(/연구소명[^<]*<[^>]+>([^<]+)/i);
        const labName = labNameMatch ? labNameMatch[1].trim() : '';
        
        // 인정번호 추출
        const certNumberMatch = rowHtml.match(/인정번호[^<]*<[^>]+>([^<]+)/i);
        const certNumber = certNumberMatch ? certNumberMatch[1].trim() : '';
        
        // 인정일자 추출
        const certDateMatch = rowHtml.match(/인정일자[^<]*<[^>]+>(\d{4}-\d{2}-\d{2})/i);
        const certDate = certDateMatch ? certDateMatch[1] : '';
        
        // 연구소 유형 추출 (연구소/전담부서)
        const typeMatch = rowHtml.match(/유형[^<]*<[^>]+>([^<]+)/i);
        const labType = typeMatch ? typeMatch[1].trim() : '';
        
        // 소재지 추출
        const addressMatch = rowHtml.match(/소재지[^<]*<[^>]+>([^<]+)/i);
        const address = addressMatch ? addressMatch[1].trim() : '';
        
        if (companyNameValue && (labName || certNumber)) {
          results.push({
            companyName: companyNameValue,
            labName: labName,
            certNumber: certNumber,
            certDate: certDate,
            labType: labType,
            address: address
          });
        }
      }
      
      return results;
    };

    const labList = parseResearchLabData(html);

    if (labList.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: false,
          message: '기업부설연구소 정보를 찾을 수 없습니다.'
        })
      };
    }

    // 검색어와 가장 일치하는 결과 찾기
    let bestMatch = labList[0];
    
    if (companyName) {
      for (const item of labList) {
        if (item.companyName.includes(companyName) || companyName.includes(item.companyName)) {
          bestMatch = item;
          break;
        }
      }
    }

    console.log(`부설연구소 검색 완료: ${bestMatch.companyName}, ${bestMatch.labType || '연구소'}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        hasLab: true,
        companyName: bestMatch.companyName,
        labName: bestMatch.labName,
        labType: bestMatch.labType || '기업부설연구소',
        certNumber: bestMatch.certNumber,
        certDate: bestMatch.certDate,
        address: bestMatch.address,
        message: '기업부설연구소 보유'
      })
    };

  } catch (error) {
    console.error('부설연구소 API 오류:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        message: '부설연구소 정보 조회 중 오류가 발생했습니다: ' + error.message
      })
    };
  }
};
