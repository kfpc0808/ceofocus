
        
        // ===== iOS Safari 최적화 =====
        
        // iOS 뷰포트 높이 이슈 해결
        function setVH() {
            const vh = window.innerHeight * 0.01;
            document.documentElement.style.setProperty('--vh', `${vh}px`);
        }
        
        // 초기 설정 및 리사이즈 시 재계산
        setVH();
        window.addEventListener('resize', setVH);
        window.addEventListener('orientationchange', setVH);
        
        // iOS 모달 스크롤 잠금
        let scrollPosition = 0;
        
        function lockBodyScroll() {
            scrollPosition = window.pageYOffset;
            document.body.style.overflow = 'hidden';
            document.body.style.position = 'fixed';
            document.body.style.top = `-${scrollPosition}px`;
            document.body.style.width = '100%';
        }
        
        function unlockBodyScroll() {
            document.body.style.removeProperty('overflow');
            document.body.style.removeProperty('position');
            document.body.style.removeProperty('top');
            document.body.style.removeProperty('width');
            window.scrollTo(0, scrollPosition);
        }
        
        // 기존 openModal, closeModal 함수 개선
        const originalOpenModal = window.openModal || function(id) {
            document.getElementById(id)?.classList.add('active');
        };
        
        const originalCloseModal = window.closeModal || function(id) {
            document.getElementById(id)?.classList.remove('active');
        };
        
        window.openModal = function(id) {
            lockBodyScroll();
            originalOpenModal(id);
        };
        
        window.closeModal = function(id) {
            unlockBodyScroll();
            originalCloseModal(id);
        };
        
        // iOS input 포커스 시 뷰포트 조정
        if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
            const inputs = document.querySelectorAll('input, textarea');
            inputs.forEach(input => {
                input.addEventListener('focus', function() {
                    setTimeout(() => {
                        this.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 300);
                });
            });
        }
        
        // 더블 탭 줌 방지
        let lastTouchEnd = 0;
        document.addEventListener('touchend', function(event) {
            const now = Date.now();
            if (now - lastTouchEnd <= 300) {
                event.preventDefault();
            }
            lastTouchEnd = now;
        }, { passive: false });
        
        // iOS Standalone 모드 감지
        if (window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches) {
            console.log('📱 iOS Standalone 모드에서 실행 중');
            document.body.classList.add('ios-standalone');
        }
        // ===== 전역 변수 =====
        let accessToken = null;
        let isDriveConnected = false;
        let tokenExpiresAt = null; // 토큰 만료 시간 추적 (밀리초)
        let tokenRefreshInterval = null; // 자동 갱신 타이머
        let isPushEnabled = false;
        let customers = [];
        let messages = [];
        let templates = [];
        let anniversarySchedules = [];
        let pushSubscriptions = [];
        let selectedCustomersData = {};
        let selectedCustomersForDelete = []; // 고객관리 탭에서 삭제용 선택 배열
        let customerGroups = ['주부', '회사원', '공무원', '사업가', '의사', '자영업', '프리랜서']; // 고객 그룹 목록
        
        // ===== 예약 메시지 관련 변수 (NEW) =====
        let scheduledMessages = []; // 예약된 메시지 목록
        
        let appSettings = {
            quietHoursStart: '21:00',
            quietHoursEnd: '08:00',
            lastSync: null
        };

        const CLIENT_ID = '288996084140-uso4i9esrda4s70mprd3skl8ocsukc6o.apps.googleusercontent.com';
        const SCOPES = 'https://www.googleapis.com/auth/drive.file';
        
        // Firebase 설정
        const firebaseConfig = {
            apiKey: "AIzaSyDbufefZCVqCY8QQppcdQFoqVFpMriv1m0",
            authDomain: "kfpc-company-support-project.firebaseapp.com",
            databaseURL: "https://kfpc-company-support-project-default-rtdb.asia-southeast1.firebasedatabase.app",
            projectId: "kfpc-company-support-project",
            storageBucket: "kfpc-company-support-project.firebasestorage.app",
            messagingSenderId: "1012609333373",
            appId: "1:1012609333373:web:ffba9039a7f9568356d914",
            measurementId: "G-Y757PLYBEE"
        };
        
        // Firebase 초기화
        let firebaseAuth = null;
        let currentUser = null;
        try {
            if (typeof firebase !== 'undefined' && !firebase.apps.length) {
                firebase.initializeApp(firebaseConfig);
                firebaseAuth = firebase.auth();
            }
        } catch (error) {
            console.warn('Firebase 초기화 실패:', error);
        }
        
        // 실시간 동기화를 위한 변수들
        let lastModifiedTime = {};  // 각 파일별 마지막 수정 시간
        let syncCheckInterval = null;  // 동기화 체크 인터벌
        let isEditing = false;  // 현재 편집 중인지 여부
        
        // ⭐ 성능 최적화 변수들 (8000명 고객 대응)
        let isInitialLoad = true;  // 초기 로드 플래그 (중복 메시지 방지)
        let isLoadingData = false;  // 데이터 로딩 중 플래그 (중복 로드 방지)
        let currentAlertTimeout = null;  // 알림 타이머 (중복 알림 방지)
        
        // ⭐ 페이지네이션 변수들 (대용량 데이터 렌더링 최적화)
        const ITEMS_PER_PAGE = 20;  // 한 페이지당 20명씩 표시 (테이블 형식)
        let currentPage = 1;  // 현재 페이지
        let totalPages = 1;  // 총 페이지 수
        
        // 구글 드라이브 파일명
        const FILES = {
            customers: 'pushcustomer_customers.fmd',
            messages: 'pushcustomer_messages.fmd',
            templates: 'pushcustomer_templates.fmd',
            inviteCustomers: 'pushcustomer_invite.fmd',
            subscriptions: 'pushcustomer_subscriptions.fmd',
            settings: 'pushcustomer_settings.fmd'
        };

        // AES-GCM 암호화 키 (실제로는 더 안전한 방식으로 관리)
        const ENC_SALT = 'kfpc-push-manager-2025-secure-key';

        // ===== 암호화/복호화 (Web Crypto API - AES-GCM) =====
        async function makeKey() {
            const raw = new TextEncoder().encode(ENC_SALT);
            const hash = await crypto.subtle.digest('SHA-256', raw);
            return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
        }

        async function encryptData(obj) {
            try {
                const key = await makeKey();
                const iv = crypto.getRandomValues(new Uint8Array(12));
                const data = new TextEncoder().encode(JSON.stringify(obj));
                const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
                return btoa(JSON.stringify({ 
                    iv: Array.from(iv), 
                    ct: Array.from(new Uint8Array(ct)) 
                }));
            } catch (e) {
                console.error('암호화 실패:', e);
                return null;
            }
        }

        async function decryptData(b64) {
            try {
                const { iv, ct } = JSON.parse(atob(b64));
                const key = await makeKey();
                const buf = new Uint8Array(ct);
                const pt = await crypto.subtle.decrypt(
                    { name: 'AES-GCM', iv: new Uint8Array(iv) }, 
                    key, 
                    buf
                );
                return JSON.parse(new TextDecoder().decode(pt));
            } catch (e) {
                console.error('복호화 실패:', e);
                return null;
            }
        }

        // ===== Google Drive 연동 =====
        async function connectDrive() {
            try {
                const tokenClient = google.accounts.oauth2.initTokenClient({
                    client_id: CLIENT_ID,
                    scope: SCOPES,
                    callback: async (response) => {
                        if (response.access_token) {
                            accessToken = response.access_token;
                            
                            // 토큰 만료 시간 계산 (현재 시간 + 3600초 = 1시간)
                            const expiresIn = response.expires_in || 3600; // 기본 1시간
                            tokenExpiresAt = Date.now() + (expiresIn * 1000);
                            
                            // localStorage에 저장
                            localStorage.setItem('googleAccessToken', accessToken);
                            localStorage.setItem('tokenExpiresAt', tokenExpiresAt.toString());
                            
                            isDriveConnected = true;
                            updateDriveStatus(true);
                            
                            // 자동 토큰 갱신 스케줄 설정 (만료 5분 전에 갱신)
                            setupTokenAutoRefresh();
                            
                            // Firebase 로그인 체크
                            await checkFirebaseLogin();
                            
                            await loadAllData();
                            
                            // 실시간 동기화 시작 (3초마다)
                            if (syncCheckInterval) clearInterval(syncCheckInterval);
                            syncCheckInterval = setInterval(checkForUpdates, 3000);
                            console.log('✅ 실시간 동기화 시작 (3초마다 체크)');
                            
                            showAlert('Drive 연동이 완료되었습니다!', 'success');
                        }
                    },
                });
                tokenClient.requestAccessToken();
            } catch (error) {
                console.error('Drive 연동 오류:', error);
                showAlert('Drive 연동에 실패했습니다. 다시 시도해주세요.', 'error');
            }
        }

        // ===== 토큰 자동 갱신 스케줄 설정 =====
        function setupTokenAutoRefresh() {
            // 기존 타이머 제거
            if (tokenRefreshInterval) {
                clearTimeout(tokenRefreshInterval);
            }
            
            // 만료 5분 전에 자동 갱신 (5분 = 300,000 밀리초)
            const timeUntilRefresh = (tokenExpiresAt - Date.now()) - (5 * 60 * 1000);
            
            if (timeUntilRefresh > 0) {
                tokenRefreshInterval = setTimeout(async () => {
                    console.log('🔄 토큰 자동 갱신 시작...');
                    await refreshTokenSilently();
                }, timeUntilRefresh);
                
                const refreshTime = new Date(Date.now() + timeUntilRefresh);
                console.log(`⏰ 다음 토큰 갱신 예정: ${refreshTime.toLocaleTimeString()}`);
            } else {
                // 이미 만료 시간이 지났으면 즉시 갱신
                console.log('⚠️ 토큰이 만료되었거나 곧 만료됩니다. 즉시 갱신합니다.');
                refreshTokenSilently();
            }
        }
        
        // ===== 조용히 토큰 갱신 (사용자 개입 없이) =====
        async function refreshTokenSilently() {
            try {
                console.log('🔄 토큰 갱신 중...');
                
                const tokenClient = google.accounts.oauth2.initTokenClient({
                    client_id: CLIENT_ID,
                    scope: SCOPES,
                    prompt: '', // 빈 문자열로 설정하여 팝업 없이 갱신 시도
                    callback: async (response) => {
                        if (response.access_token) {
                            accessToken = response.access_token;
                            
                            // 새로운 만료 시간 계산
                            const expiresIn = response.expires_in || 3600;
                            tokenExpiresAt = Date.now() + (expiresIn * 1000);
                            
                            // localStorage 업데이트
                            localStorage.setItem('googleAccessToken', accessToken);
                            localStorage.setItem('tokenExpiresAt', tokenExpiresAt.toString());
                            
                            console.log('✅ 토큰 갱신 성공');
                            
                            // 다음 자동 갱신 스케줄
                            setupTokenAutoRefresh();
                        } else if (response.error) {
                            console.error('❌ 토큰 갱신 실패:', response.error);
                            // 갱신 실패 시 재로그인 필요
                            handleTokenRefreshFailure();
                        }
                    },
                });
                
                // 조용한 갱신 시도
                tokenClient.requestAccessToken({ prompt: '' });
                
            } catch (error) {
                console.error('❌ 토큰 갱신 오류:', error);
                handleTokenRefreshFailure();
            }
        }
        
        // ===== 토큰 갱신 실패 처리 =====
        function handleTokenRefreshFailure() {
            console.log('⚠️ 토큰 갱신 실패 - 재로그인 필요');
            
            // 저장된 토큰 삭제
            localStorage.removeItem('googleAccessToken');
            localStorage.removeItem('tokenExpiresAt');
            
            // 상태 초기화
            accessToken = null;
            tokenExpiresAt = null;
            isDriveConnected = false;
            updateDriveStatus(false);
            
            // 사용자에게 알림
            showAlert('⚠️ Drive 연동이 만료되었습니다. 다시 연동해주세요.', 'warning');
        }
        
        // ===== 토큰 만료 여부 체크 =====
        function isTokenExpired() {
            if (!tokenExpiresAt) return true;
            // 현재 시간이 만료 시간을 넘었는지 확인
            return Date.now() >= tokenExpiresAt;
        }

        function updateDriveStatus(connected) {
            const btn = document.getElementById('driveBtn');
            const statusDot = document.getElementById('statusDot');
            const statusText = document.getElementById('statusText');
            
            if (connected) {
                btn.textContent = '✅ Drive 연동됨';
                btn.style.opacity = '0.7';
                statusDot.className = 'status-dot connected';
                statusText.textContent = 'Drive 연결됨';
            } else {
                btn.textContent = '📁 Drive 연동';
                statusDot.className = 'status-dot disconnected';
                statusText.textContent = 'Drive 미연결';
            }
        }

        // ===== Firebase 로그인 체크 =====
        async function checkFirebaseLogin() {
            if (!firebaseAuth) return;
            
            return new Promise((resolve) => {
                firebaseAuth.onAuthStateChanged(async (user) => {
                    if (user) {
                        currentUser = user;
                        console.log('✅ Firebase 로그인 완료:', user.email);
                        resolve(true);
                    } else {
                        console.log('ℹ️ Firebase 로그인 필요');
                        
                        try {
                            const provider = new firebase.auth.GoogleAuthProvider();
                            await firebaseAuth.signInWithPopup(provider);
                            console.log('✅ Firebase 자동 로그인 완료');
                            resolve(true);
                        } catch (error) {
                            console.warn('Firebase 로그인 실패:', error);
                            resolve(false);
                        }
                    }
                });
            });
        }

        // ===== 실시간 동기화 체크 (3초마다) =====
        async function checkForUpdates() {
            if (!accessToken || isEditing) return;
            
            try {
                // 각 파일의 modifiedTime을 체크
                for (const [key, fileName] of Object.entries(FILES)) {
                    const file = await findFileInDrive(fileName);
                    if (!file) continue;
                    
                    const cloudModifiedTime = new Date(file.modifiedTime).getTime();
                    
                    // 이전에 저장된 modifiedTime과 비교
                    if (lastModifiedTime[key] && cloudModifiedTime > lastModifiedTime[key]) {
                        console.log(`🔄 ${fileName} 파일 업데이트 감지, 자동 로드 중...`);
                        
                        // 특정 파일만 다시 로드
                        const data = await loadFromDrive(fileName);
                        if (data) {
                            switch(key) {
                                case 'customers':
                                    customers = data;
                                    renderCustomers();
                                    break;
                                case 'messages':
                                    messages = data;
                                    renderMessages();
                                    break;
                                case 'templates':
                                    templates = data;
                                    renderTemplates();
                                    break;
                                case 'inviteCustomers':
                                    inviteCustomers = data;
                                    if (typeof renderInviteCustomers === 'function') {
                                        renderInviteCustomers();
                                    }
                                    break;
                                case 'settings':
                                    Object.assign(systemSettings, data);
                                    break;
                            }
                            
                            lastModifiedTime[key] = cloudModifiedTime;
                            console.log(`✅ ${fileName} 업데이트 완료`);
                        }
                    } else if (!lastModifiedTime[key]) {
                        // 초기 로드 시 modifiedTime 저장
                        lastModifiedTime[key] = cloudModifiedTime;
                    }
                }
            } catch (error) {
                console.error('동기화 체크 오류:', error);
            }
        }

        // ===== Drive에서 파일 찾기 (modifiedTime 포함) =====
        async function findFileInDrive(fileName) {
            try {
                const response = await fetch(
                    `https://www.googleapis.com/drive/v3/files?q=name='${fileName}'&fields=files(id,name,modifiedTime)`,
                    {
                        headers: { Authorization: `Bearer ${accessToken}` }
                    }
                );
                
                if (!response.ok) return null;
                
                const data = await response.json();
                return data.files && data.files.length > 0 ? data.files[0] : null;
            } catch (error) {
                console.error('파일 찾기 오류:', error);
                return null;
            }
        }


        // ===== 데이터 로드/저장 =====
        async function loadAllData() {
            // ⭐ 중복 로드 방지
            if (isLoadingData) {
                console.log('⚠️ 이미 데이터 로딩 중... 스킵');
                return;
            }
            
            // ⭐ Drive 연동 안되었으면 메시지 없이 종료
            if (!accessToken || !isDriveConnected) {
                console.log('ℹ️ Drive 연동 전 - 로드 스킵');
                return;
            }
            
            isLoadingData = true;
            showLoading(true);
            
            try {
                // 모든 파일을 병렬로 로드 (순차 로드보다 훨씬 빠름)
                const [
                    customersData,
                    messagesData,
                    templatesData,
                    inviteCustomersData,
                    subsData,
                    settingsData
                ] = await Promise.all([
                    loadFromDrive(FILES.customers),
                    loadFromDrive(FILES.messages),
                    loadFromDrive(FILES.templates),
                    loadFromDrive(FILES.inviteCustomers),
                    loadFromDrive(FILES.subscriptions),
                    loadFromDrive(FILES.settings)
                ]);
                
                // 데이터 할당
                if (customersData) customers = customersData;
                if (messagesData) messages = messagesData;
                if (templatesData) templates = templatesData;
                if (inviteCustomersData) {
                    inviteCustomers = inviteCustomersData;
                    updateInviteStats();
                    renderInviteCustomers();
                }
                if (subsData) pushSubscriptions = subsData;
                if (settingsData) appSettings = { ...appSettings, ...settingsData };
                
                // 그룹 데이터 로드
                await loadGroupsFromFile();
                
                // UI 업데이트
                renderCustomers();
                renderCustomersForSend();
                renderMessages();
                renderTemplates();
                updateStats();
                updateSettingsUI();
                
                appSettings.lastSync = new Date().toISOString();
                await saveToDrive(FILES.settings, appSettings);
                
                // ⭐ 초기 로드일 때만 성공 메시지 표시 (중복 메시지 방지)
                if (isInitialLoad) {
                    showAlert('✅ 데이터를 성공적으로 불러왔습니다!', 'success');
                    isInitialLoad = false;
                } else {
                    console.log('✅ 백그라운드 동기화 완료 (조용히)');
                }
                
            } catch (error) {
                console.error('❌ 데이터 로드 오류:', error);
                showAlert('⚠️ 데이터를 불러오는데 실패했습니다.', 'error');
            } finally {
                showLoading(false);
                isLoadingData = false;  // ⭐ 로딩 완료 플래그 해제
            }
        }

        async function loadFromDrive(fileName) {
            if (!accessToken) return null;
            
            try {
                // 파일 검색 (modifiedTime 포함)
                const searchResponse = await fetch(
                    `https://www.googleapis.com/drive/v3/files?q=name='${fileName}' and trashed=false&fields=files(id,name,modifiedTime)`,
                    {
                        headers: { 'Authorization': `Bearer ${accessToken}` }
                    }
                );
                
                if (!searchResponse.ok) {
                    if (searchResponse.status === 401) {
                        // 토큰 만료
                        showAlert('인증이 만료되었습니다. 다시 연동해주세요.', 'error');
                        localStorage.removeItem('googleAccessToken');
                        accessToken = null;
                        isDriveConnected = false;
                        updateDriveStatus(false);
                        return null;
                    }
                    throw new Error('파일 검색 실패');
                }
                
                const searchData = await searchResponse.json();
                
                if (!searchData.files || searchData.files.length === 0) {
                    return null; // 파일이 없으면 null 반환
                }
                
                const file = searchData.files[0];
                const fileId = file.id;
                
                // modifiedTime 저장
                const fileKey = Object.keys(FILES).find(key => FILES[key] === fileName);
                if (fileKey && file.modifiedTime) {
                    lastModifiedTime[fileKey] = new Date(file.modifiedTime).getTime();
                }
                
                // 파일 내용 다운로드
                const downloadResponse = await fetch(
                    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
                    {
                        headers: { 'Authorization': `Bearer ${accessToken}` }
                    }
                );
                
                if (!downloadResponse.ok) throw new Error('파일 다운로드 실패');
                
                const fileContent = await downloadResponse.text();
                
                // 암호화된 데이터인지 일반 JSON인지 확인
                try {
                    // 먼저 일반 JSON으로 파싱 시도
                    return JSON.parse(fileContent);
                } catch {
                    // 일반 JSON이 아니면 암호화된 것으로 간주하고 복호화
                    return await decryptData(fileContent);
                }
                
            } catch (error) {
                console.error(`${fileName} 로드 오류:`, error);
                return null;
            }
        }

        async function saveToDrive(fileName, data) {
            if (!accessToken) {
                showAlert('Drive가 연동되지 않았습니다.', 'error');
                return false;
            }
            
            try {
                const encryptedData = await encryptData(data);
                if (!encryptedData) throw new Error('암호화 실패');
                
                // 기존 파일 검색
                const searchResponse = await fetch(
                    `https://www.googleapis.com/drive/v3/files?q=name='${fileName}' and trashed=false`,
                    {
                        headers: { 'Authorization': `Bearer ${accessToken}` }
                    }
                );
                
                const searchData = await searchResponse.json();
                let fileId = searchData.files && searchData.files.length > 0 ? searchData.files[0].id : null;
                
                const blob = new Blob([encryptedData], { type: 'text/plain' });
                const metadata = {
                    name: fileName,
                    mimeType: 'text/plain'
                };
                
                if (fileId) {
                    // 파일 업데이트
                    const form = new FormData();
                    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
                    form.append('file', blob);
                    
                    const response = await fetch(
                        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id,modifiedTime`,
                        {
                            method: 'PATCH',
                            headers: { 'Authorization': `Bearer ${accessToken}` },
                            body: form
                        }
                    );
                    
                    if (!response.ok) throw new Error('파일 업데이트 실패');
                    
                    // modifiedTime 업데이트
                    const result = await response.json();
                    const fileKey = Object.keys(FILES).find(key => FILES[key] === fileName);
                    if (fileKey && result.modifiedTime) {
                        lastModifiedTime[fileKey] = new Date(result.modifiedTime).getTime();
                    }
                } else {
                    // 새 파일 생성
                    const form = new FormData();
                    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
                    form.append('file', blob);
                    
                    const response = await fetch(
                        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime',
                        {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${accessToken}` },
                            body: form
                        }
                    );
                    
                    if (!response.ok) throw new Error('파일 생성 실패');
                    
                    // modifiedTime 업데이트
                    const result = await response.json();
                    const fileKey = Object.keys(FILES).find(key => FILES[key] === fileName);
                    if (fileKey && result.modifiedTime) {
                        lastModifiedTime[fileKey] = new Date(result.modifiedTime).getTime();
                    }
                }
                
                return true;
                
            } catch (error) {
                console.error(`${fileName} 저장 오류:`, error);
                showAlert('데이터 저장에 실패했습니다.', 'error');
                return false;
            }
        }

        // ===== 웹푸시 알림 =====
        async function requestPushPermission() {
            if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
                showAlert('이 브라우저는 푸시 알림을 지원하지 않습니다.', 'error');
                return;
            }
            
            try {
                const permission = await Notification.requestPermission();
                
                if (permission === 'granted') {
                    isPushEnabled = true;
                    updatePushStatus(true);
                    showAlert('푸시 알림이 허용되었습니다!', 'success');
                    
                    // Service Worker 등록
                    // await registerServiceWorker();
                } else {
                    showAlert('푸시 알림이 거부되었습니다.', 'error');
                }
            } catch (error) {
                console.error('푸시 권한 요청 오류:', error);
                showAlert('푸시 알림 설정에 실패했습니다.', 'error');
            }
        }

        function updatePushStatus(enabled) {
            const btn = document.getElementById('pushPermissionBtn');
            if (enabled) {
                btn.textContent = '✅ 알림 활성화됨';
                btn.style.opacity = '0.7';
            } else {
                btn.textContent = '🔔 알림 허용';
            }
        }

        // ===== 공통 함수 =====
        // 푸시 구독 상태 표시 함수
        function getPushStatusDisplay(customerId) {
            const subscription = pushSubscriptions.find(s => s.customerId === customerId);
            
            if (!subscription) {
                return {
                    icon: '⚠️',
                    text: '미구독',
                    color: '#ff4444'
                };
            }
            
            if (subscription.status === 'unsubscribed') {
                return {
                    icon: '⏰',
                    text: '해지',
                    color: '#ff9800'
                };
            }
            
            return {
                icon: '🔔',
                text: '구독',
                color: '#4CAF50'
            };
        }

        // 고객 이름 포맷팅 함수 (호칭 포함)
        function formatCustomerName(customer) {
            if (!customer) return '';
            
            let name = customer.name;
            
            // 직함 추가 (usePosition이 true이고 position이 있으면)
            if (customer.usePosition && customer.position) {
                name += ' ' + customer.position;
            }
            
            // 호칭 추가 (useHonorific이 true이고 honorific이 있으면)
            if (customer.useHonorific && customer.honorific) {
                name += customer.honorific;
            }
            
            return name;
        }

        // ===== 고객 관리 =====
        // ⭐ 고객 관리 탭 전체 선택/해제
        window.toggleSelectAllCustomers = function() {
            const checkbox = document.getElementById('selectAllCheckbox');
            const allCheckboxes = document.querySelectorAll('#customersTableBody input[type="checkbox"]');
            
            if (checkbox.checked) {
                // 전체 선택
                allCheckboxes.forEach(cb => {
                    if (!cb.checked) {
                        cb.checked = true;
                        const customerId = cb.getAttribute('onchange').match(/'([^']+)'/)[1];
                        if (!selectedCustomersForDelete.includes(customerId)) {
                            selectedCustomersForDelete.push(customerId);
                        }
                    }
                });
            } else {
                // 전체 해제
                allCheckboxes.forEach(cb => {
                    if (cb.checked) {
                        cb.checked = false;
                        const customerId = cb.getAttribute('onchange').match(/'([^']+)'/)[1];
                        const index = selectedCustomersForDelete.indexOf(customerId);
                        if (index > -1) {
                            selectedCustomersForDelete.splice(index, 1);
                        }
                    }
                });
            }
        };
        
        // ⭐ 테이블 형식 렌더링 함수
        function renderCustomers() {
            const tbody = document.getElementById('customersTableBody');
            const searchTerm = document.getElementById('customerSearch')?.value.toLowerCase() || '';
            const sortOrder = document.getElementById('sortOrder')?.value || 'newest';
            const groupFilter = document.getElementById('groupFilter')?.value || 'all';
            
            // 필터링
            let filtered = customers.filter(c => {
                const matchSearch = c.name.toLowerCase().includes(searchTerm) ||
                    (c.company && c.company.toLowerCase().includes(searchTerm)) ||
                    (c.position && c.position.toLowerCase().includes(searchTerm)) ||
                    (c.tags && c.tags.some(tag => tag.toLowerCase().includes(searchTerm)));
                
                const matchGroup = groupFilter === 'all' || (c.group && c.group === groupFilter);
                
                return matchSearch && matchGroup;
            });
            
            // 정렬
            filtered.sort((a, b) => {
                switch(sortOrder) {
                    case 'newest':
                        // 최신순 (ID가 큰 것이 최근 추가)
                        return b.id.localeCompare(a.id);
                    case 'oldest':
                        // 오래된순
                        return a.id.localeCompare(b.id);
                    case 'name-asc':
                        return (a.name || '').localeCompare(b.name || '', 'ko');
                    case 'name-desc':
                        return (b.name || '').localeCompare(a.name || '', 'ko');
                    case 'phone-asc':
                        return (a.phone || '').localeCompare(b.phone || '');
                    case 'phone-desc':
                        return (b.phone || '').localeCompare(a.phone || '');
                    default:
                        return 0;
                }
            });
            
            // 고객 수 업데이트
            document.getElementById('customerCount').textContent = filtered.length;
            
            if (filtered.length === 0) {
                tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; padding: 40px; opacity: 0.7;">등록된 고객이 없습니다</td></tr>';
                return;
            }
            
            // 페이지네이션 계산
            totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
            if (currentPage > totalPages) currentPage = totalPages;
            if (currentPage < 1) currentPage = 1;
            
            const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
            const endIndex = startIndex + ITEMS_PER_PAGE;
            const pageCustomers = filtered.slice(startIndex, endIndex);
            
            // 테이블 행 렌더링
            tbody.innerHTML = '';
            
            pageCustomers.forEach((customer, index) => {
                const globalIndex = startIndex + index + 1; // 전체 순번
                const isSelected = selectedCustomersForDelete.includes(customer.id);
                const pushStatus = getPushStatusDisplay(customer.id);
                const displayName = formatCustomerName(customer);
                
                // 호칭 추출 (님, 귀하, etc.)
                const honorific = customer.honorific || '님';
                
                const row = document.createElement('tr');
                row.id = `customer-row-${customer.id}`;
                row.className = isSelected ? 'selected' : '';
                
                row.innerHTML = `
                    <td>
                        <input type="checkbox" 
                               ${isSelected ? 'checked' : ''} 
                               onchange="toggleCustomerForDelete('${customer.id}')"
                               style="width: 18px; height: 18px; cursor: pointer;">
                    </td>
                    <td>${globalIndex}</td>
                    <td>
                        <span class="editable-field" data-field="name" data-id="${customer.id}" onclick="enableInlineEdit(this)">
                            ${customer.name || ''}
                        </span>
                    </td>
                    <td>
                        <span class="editable-field" data-field="position" data-id="${customer.id}" onclick="enableInlineEdit(this)">
                            ${customer.position || '-'}
                        </span>
                    </td>
                    <td>
                        <span class="editable-field" data-field="honorific" data-id="${customer.id}" onclick="enableInlineEdit(this)">
                            ${honorific}
                        </span>
                    </td>
                    <td>
                        <span class="editable-field" data-field="company" data-id="${customer.id}" onclick="enableInlineEdit(this)">
                            ${customer.company || '-'}
                        </span>
                    </td>
                    <td>
                        <span class="editable-field" data-field="phone" data-id="${customer.id}" onclick="enableInlineEdit(this)">
                            ${customer.phone || '-'}
                        </span>
                    </td>
                    <td>
                        <span class="editable-field" data-field="birthday" data-id="${customer.id}" onclick="enableInlineEdit(this)">
                            ${customer.birthday || '-'}
                        </span>
                    </td>
                    <td>
                        <span class="subscription-status ${pushStatus.text === '구독' ? 'subscribed' : 'not-subscribed'}">
                            ${pushStatus.icon} ${pushStatus.text}
                        </span>
                    </td>
                    <td>
                        <span class="editable-field" data-field="group" data-id="${customer.id}" onclick="enableInlineEdit(this)">
                            ${customer.group || '-'}
                        </span>
                    </td>
                    <td style="white-space: nowrap;">
                        <button class="table-action-btn btn-group" onclick="showGroupSelector('${customer.id}')" title="그룹 설정">그룹</button>
                        <button class="table-action-btn btn-invite" onclick="copyInviteLink('${customer.id}')" title="초대 링크">초대</button>
                        <button class="table-action-btn btn-push" onclick="sendPushToCustomer('${customer.id}')" title="푸시 전송">푸시</button>
                        <button class="table-action-btn btn-edit" onclick="editCustomer('${customer.id}')" title="수정">수정</button>
                        <button class="table-action-btn btn-save" onclick="window.saveInlineEdit('${customer.id}')" title="저장">저장</button>
                        <button class="table-action-btn btn-delete" onclick="deleteCustomer('${customer.id}')" title="삭제">삭제</button>
                    </td>
                `;
                
                tbody.appendChild(row);
            });
            
            // 페이지네이션 렌더링
            renderPagination();
        }
        
        // 인라인 편집 활성화
        window.enableInlineEdit = function(element) {
            if (element.querySelector('input')) return; // 이미 편집 중이면 리턴
            
            const field = element.dataset.field;
            const customerId = element.dataset.id;
            const currentValue = element.textContent.trim();
            const actualValue = currentValue === '-' ? '' : currentValue;
            
            // 해당 행 찾기
            const row = element.closest('tr');
            
            // 입력 필드 생성
            const input = document.createElement('input');
            
            // 생일 필드는 date picker
            if (field === 'birthday') {
                input.type = 'date';
                // YYYY-MM-DD 형식으로 변환 (한국어 날짜가 아닌 경우)
                input.value = actualValue || '';
            } else {
                input.type = 'text';
                input.value = actualValue;
            }
            
            input.className = 'inline-edit';
            input.dataset.field = field;
            input.dataset.id = customerId;
            input.dataset.originalValue = actualValue;
            
            // Enter 키 없이도 입력 가능 (저장은 저장 버튼으로)
            input.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    input.blur();
                } else if (e.key === 'Escape') {
                    cancelInlineEdit(row, customerId);
                }
            });
            
            // blur 시에는 그냥 유지 (취소하지 않음)
            input.addEventListener('blur', function() {
                // 아무 것도 안 함 - 저장 버튼으로만 저장
            });
            
            element.textContent = '';
            element.appendChild(input);
            input.focus();
            if (field !== 'birthday') {
                input.select();
            }
            
            // 편집 중 표시
            row.classList.add('editing');
        };
        
        // 인라인 편집 취소
        function cancelInlineEdit(row, customerId) {
            row.classList.remove('editing');
            
            const inputs = row.querySelectorAll('.inline-edit');
            inputs.forEach(input => {
                const span = input.parentElement;
                span.textContent = input.dataset.originalValue || '-';
            });
        }
        
        // 인라인 편집 저장
        window.saveInlineEdit = async function(customerId) {
            const row = document.getElementById(`customer-row-${customerId}`);
            if (!row) {
                console.log('행을 찾을 수 없습니다');
                return;
            }
            
            const inputs = row.querySelectorAll('.inline-edit');
            if (inputs.length === 0) {
                console.log('수정된 내용이 없습니다');
                return;
            }
            
            const customer = customers.find(c => c.id === customerId);
            if (!customer) {
                console.error('고객을 찾을 수 없습니다');
                return;
            }
            
            let changed = false;
            inputs.forEach(input => {
                const field = input.dataset.field;
                let newValue = input.value.trim();
                const originalValue = input.dataset.originalValue || '';
                
                // 전화번호 필드일 때 하이픈 자동 추가
                if (field === 'phone' && newValue) {
                    const numbersOnly = newValue.replace(/[^0-9]/g, '');
                    if (numbersOnly.length === 11) {
                        newValue = `${numbersOnly.slice(0,3)}-${numbersOnly.slice(3,7)}-${numbersOnly.slice(7)}`;
                    } else if (numbersOnly.length === 10) {
                        newValue = `${numbersOnly.slice(0,3)}-${numbersOnly.slice(3,6)}-${numbersOnly.slice(6)}`;
                    }
                }
                
                if (newValue !== originalValue) {
                    customer[field] = newValue;
                    changed = true;
                    console.log(`${field} 필드 업데이트: "${originalValue}" -> "${newValue}"`);
                }
            });
            
            if (changed) {
                try {
                    // Google Drive에 저장
                    await saveToDrive(FILES.customers, customers);
                    console.log('✅ 고객 정보 저장 완료');
                    
                    // 테이블 다시 렌더링
                    renderCustomers();
                    
                    // 간단한 성공 메시지
                    showAlert('💾 저장 완료!', 'success');
                } catch (error) {
                    console.error('저장 실패:', error);
                    showAlert('❌ 저장 실패: ' + error.message, 'error');
                }
            } else {
                // 변경사항 없음 - 편집 모드 종료
                cancelInlineEdit(row, customerId);
            }
        };
        
        // ⭐ 페이지네이션 렌더링 함수 추가
        function renderPagination() {
            const container = document.getElementById('customerListControls');
            if (!container) return;
            
            // 기존 페이지네이션이 있으면 제거
            const existingPagination = container.querySelector('.pagination-controls');
            if (existingPagination) {
                existingPagination.remove();
            }
            
            if (totalPages <= 1) return; // 페이지가 1개면 페이지네이션 불필요
            
            const paginationHTML = `
                <div class="pagination-controls" style="display: flex; justify-content: center; align-items: center; gap: 8px; margin-top: 20px; flex-wrap: wrap;">
                    <button onclick="goToCustomerPage(${currentPage - 1})" 
                            ${currentPage === 1 ? 'disabled' : ''}
                            style="padding: 8px 12px; background: ${currentPage === 1 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.2)'}; border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; color: white; cursor: ${currentPage === 1 ? 'not-allowed' : 'pointer'}; font-size: 13px;">
                        ◀ 이전
                    </button>
                    
                    ${generatePageButtons()}
                    
                    <button onclick="goToCustomerPage(${currentPage + 1})" 
                            ${currentPage === totalPages ? 'disabled' : ''}
                            style="padding: 8px 12px; background: ${currentPage === totalPages ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.2)'}; border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; color: white; cursor: ${currentPage === totalPages ? 'not-allowed' : 'pointer'}; font-size: 13px;">
                        다음 ▶
                    </button>
                    
                    <div style="padding: 8px 12px; background: rgba(255,255,255,0.1); border-radius: 8px; font-size: 12px; white-space: nowrap;">
                        ${(currentPage - 1) * ITEMS_PER_PAGE + 1}-${Math.min(currentPage * ITEMS_PER_PAGE, customers.length)} / ${customers.length}명
                    </div>
                </div>
            `;
            
            container.insertAdjacentHTML('beforeend', paginationHTML);
        }
        
        // ⭐ 페이지 번호 버튼 생성 함수
        function generatePageButtons() {
            let buttons = '';
            
            // 모든 페이지 번호를 다 표시
            for (let i = 1; i <= totalPages; i++) {
                const isActive = i === currentPage;
                buttons += `
                    <button onclick="goToCustomerPage(${i})" 
                            style="padding: 8px 12px; background: ${isActive ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'rgba(255,255,255,0.2)'}; border: 1px solid ${isActive ? 'transparent' : 'rgba(255,255,255,0.3)'}; border-radius: 8px; color: white; cursor: pointer; font-size: 13px; font-weight: ${isActive ? 'bold' : 'normal'}; min-width: 36px;">
                        ${i}
                    </button>
                `;
            }
            
            return buttons;
        }
        
        // ⭐ 페이지 이동 함수
        function goToCustomerPage(page) {
            if (page < 1 || page > totalPages) return;
            currentPage = page;
            
            // 최상단으로 부드럽게 스크롤
            window.scrollTo({ top: 0, behavior: 'smooth' });
            
            renderCustomers();
        }

        // ===== 그룹 관리 함수들 =====
        function updateGroupFilter() {
            const groupFilter = document.getElementById('groupFilter');
            if (!groupFilter) return;
            
            const currentValue = groupFilter.value;
            groupFilter.innerHTML = '<option value="all">전체 그룹</option>' + 
                customerGroups.map(group => `<option value="${group}">${group}</option>`).join('');
            
            // 이전 선택 유지
            if (customerGroups.includes(currentValue)) {
                groupFilter.value = currentValue;
            } else {
                groupFilter.value = 'all';
            }
            
            // 발송 탭 그룹 선택도 업데이트
            updateGroupSelectForSend();
        }

        function openGroupManagerModal() {
            renderGroupList();
            document.getElementById('groupManagerModal').classList.add('show');
        }
        
        function closeGroupManagerModal() {
            document.getElementById('groupManagerModal').classList.remove('show');
        }
        
        // ===== 이미지 가이드 모달 =====
        function openImageGuideModal() {
            document.getElementById('imageGuideModal').classList.add('active');
        }
        
        function closeImageGuideModal() {
            document.getElementById('imageGuideModal').classList.remove('active');
        }
        
        async function showGroupSelector(customerId) {
            const customer = customers.find(c => c.id === customerId);
            if (!customer) return;
            
            const groupOptions = ['<option value="">그룹 없음</option>']
                .concat(customerGroups.map(g => `<option value="${g}" ${customer.group === g ? 'selected' : ''}>${g}</option>`))
                .join('');
            
            const selectedGroup = await new Promise((resolve) => {
                const modal = document.createElement('div');
                modal.className = 'modal show';
                modal.style.zIndex = '10000';
                modal.innerHTML = `
                    <div class="modal-content" style="max-width: 400px;">
                        <div class="modal-header">
                            <h2>👥 그룹 선택</h2>
                            <button class="modal-close" onclick="this.closest('.modal').remove()">×</button>
                        </div>
                        <div class="form-group">
                            <label>${customer.name}님의 그룹</label>
                            <select id="tempGroupSelect" style="width: 100%; padding: 12px; border-radius: 8px; background: rgba(255,255,255,0.1); color: white; border: 1px solid rgba(255,255,255,0.3); font-size: 14px;">
                                ${groupOptions}
                            </select>
                        </div>
                        <div style="display: flex; gap: 10px; justify-content: flex-end;">
                            <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">취소</button>
                            <button class="btn-primary" onclick="
                                const group = document.getElementById('tempGroupSelect').value;
                                this.closest('.modal').dataset.result = group;
                                this.closest('.modal').remove();
                            ">확인</button>
                        </div>
                    </div>
                `;
                
                document.body.appendChild(modal);
                
                const checkRemoval = setInterval(() => {
                    if (!document.body.contains(modal)) {
                        clearInterval(checkRemoval);
                        resolve(modal.dataset.result || null);
                    }
                }, 100);
            });
            
            if (selectedGroup !== null) {
                if (selectedGroup) {
                    customer.group = selectedGroup;
                } else {
                    delete customer.group;
                }
                
                await saveToDrive(FILES.customers, customers);
                renderCustomers();
                showAlert(`${customer.name}님이 ${selectedGroup || '그룹 없음'}으로 변경되었습니다.`, 'success');
            }
        }

        function renderGroupList() {
            const list = document.getElementById('groupList');
            if (customerGroups.length === 0) {
                list.innerHTML = '<p style="text-align: center; opacity: 0.7; padding: 20px;">등록된 그룹이 없습니다</p>';
                return;
            }
            
            list.innerHTML = customerGroups.map(group => {
                const count = customers.filter(c => c.group === group).length;
                return `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: rgba(255,255,255,0.1); border-radius: 8px; margin-bottom: 8px;">
                        <div>
                            <strong style="font-size: 15px;">${group}</strong>
                            <span style="margin-left: 10px; opacity: 0.8; font-size: 13px;">(${count}명)</span>
                        </div>
                        <button onclick="deleteGroup('${group}')" style="padding: 6px 12px; background: #ff6b6b; border: none; border-radius: 6px; color: white; cursor: pointer; font-size: 12px;">삭제</button>
                    </div>
                `;
            }).join('');
        }

        async function addGroup() {
            const input = document.getElementById('newGroupName');
            const groupName = input.value.trim();
            
            if (!groupName) {
                showAlert('그룹명을 입력해주세요.', 'error');
                return;
            }
            
            if (customerGroups.includes(groupName)) {
                showAlert('이미 존재하는 그룹입니다.', 'error');
                return;
            }
            
            customerGroups.push(groupName);
            await saveGroupsToFile();
            
            input.value = '';
            renderGroupList();
            updateGroupFilter();
            showAlert(`'${groupName}' 그룹이 추가되었습니다.`, 'success');
        }

        async function deleteGroup(groupName) {
            const affectedCount = customers.filter(c => c.group === groupName).length;
            
            let confirmMsg = `'${groupName}' 그룹을 삭제하시겠습니까?`;
            if (affectedCount > 0) {
                confirmMsg += `\n\n이 그룹에 속한 ${affectedCount}명의 고객은 그룹 없음으로 변경됩니다.`;
            }
            
            if (!confirm(confirmMsg)) return;
            
            // 그룹 삭제
            customerGroups = customerGroups.filter(g => g !== groupName);
            
            // 해당 그룹의 고객들 그룹 정보 제거
            customers.forEach(c => {
                if (c.group === groupName) {
                    delete c.group;
                }
            });
            
            await saveGroupsToFile();
            await saveToDrive(FILES.customers, customers);
            
            renderGroupList();
            updateGroupFilter();
            renderCustomers();
            showAlert(`'${groupName}' 그룹이 삭제되었습니다.`, 'success');
        }

        async function saveGroupsToFile() {
            const groupsData = {
                groups: customerGroups,
                updatedAt: new Date().toISOString()
            };
            await saveToDrive('customer_groups.json', groupsData);
        }

        async function loadGroupsFromFile() {
            try {
                const data = await loadFromDrive('customer_groups.json');
                if (data && data.groups) {
                    customerGroups = data.groups;
                }
                updateGroupFilter();
            } catch (error) {
                console.log('그룹 데이터 로드 실패 (첫 실행일 수 있음):', error);
            }
        }

        function renderCustomersForSend() {
            const container = document.getElementById('customerGridSend');
            const searchTerm = document.getElementById('customerSearchSend')?.value.toLowerCase() || '';
            const sortOrder = document.getElementById('sortOrderSend')?.value || 'name-asc';
            const groupFilter = document.getElementById('groupFilterSend')?.value || 'all';
            
            // 필터링
            let filtered = customers.filter(c => {
                const matchSearch = c.name.toLowerCase().includes(searchTerm) ||
                    (c.company && c.company.toLowerCase().includes(searchTerm)) ||
                    (c.position && c.position.toLowerCase().includes(searchTerm)) ||
                    (c.tags && c.tags.some(tag => tag.toLowerCase().includes(searchTerm)));
                
                const matchGroup = groupFilter === 'all' || (c.group && c.group === groupFilter);
                
                return matchSearch && matchGroup;
            });
            
            // 정렬
            filtered.sort((a, b) => {
                switch(sortOrder) {
                    case 'name-asc':
                        return (a.name || '').localeCompare(b.name || '', 'ko');
                    case 'name-desc':
                        return (b.name || '').localeCompare(a.name || '', 'ko');
                    case 'phone-asc':
                        return (a.phone || '').localeCompare(b.phone || '');
                    case 'phone-desc':
                        return (b.phone || '').localeCompare(a.phone || '');
                    default:
                        return 0;
                }
            });
            
            if (filtered.length === 0) {
                container.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px; opacity: 0.7;">등록된 고객이 없습니다</td></tr>';
                return;
            }
            
            container.innerHTML = `
                <table class="customers-table">
                    <thead>
                        <tr>
                            <th style="width: 50px;">
                                <input type="checkbox" onclick="toggleSelectAll()" title="전체 선택" style="cursor: pointer; width: 18px; height: 18px;">
                            </th>
                            <th>No</th>
                            <th>성명</th>
                            <th>직함</th>
                            <th>회사명</th>
                            <th>휴대폰</th>
                            <th>그룹</th>
                            <th>푸시상태</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filtered.map((customer, index) => {
                            const isSelected = selectedCustomersData[customer.id] !== undefined;
                            const pushStatus = getPushStatusDisplay(customer.id);
                            const displayName = formatCustomerName(customer);
                            
                            return `
                                <tr class="${isSelected ? 'selected' : ''}">
                                    <td>
                                        <input type="checkbox" 
                                               ${isSelected ? 'checked' : ''} 
                                               onchange="toggleCustomerSelectionCheckbox('${customer.id}')"
                                               style="width: 18px; height: 18px; cursor: pointer;">
                                    </td>
                                    <td>${index + 1}</td>
                                    <td><strong>${displayName}</strong></td>
                                    <td>${customer.position || '-'}</td>
                                    <td>${customer.company || '-'}</td>
                                    <td>${customer.phone || '-'}</td>
                                    <td>${customer.group || '-'}</td>
                                    <td>
                                        <span class="subscription-status ${pushStatus.text === '구독' ? 'subscribed' : 'not-subscribed'}">
                                            ${pushStatus.icon} ${pushStatus.text}
                                        </span>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            `;
            
            updateSelectedInfo();
        }

        function toggleCustomerSelection(customerId) {
            const customer = customers.find(c => c.id === customerId);
            if (!customer) return;
            
            if (selectedCustomersData[customerId]) {
                delete selectedCustomersData[customerId];
            } else {
                selectedCustomersData[customerId] = customer;
            }
            
            renderCustomersForSend();
        }

        function toggleCustomerSelectionCheckbox(customerId) {
            const customer = customers.find(c => c.id === customerId);
            if (!customer) return;
            
            if (selectedCustomersData[customerId]) {
                delete selectedCustomersData[customerId];
            } else {
                selectedCustomersData[customerId] = customer;
            }
            
            renderCustomersForSend();
        }

        function toggleSelectAll() {
            const searchTerm = document.getElementById('customerSearchSend')?.value.toLowerCase() || '';
            const groupFilter = document.getElementById('groupFilterSend')?.value || 'all';
            
            const filtered = customers.filter(c => {
                const matchSearch = c.name.toLowerCase().includes(searchTerm) ||
                    (c.company && c.company.toLowerCase().includes(searchTerm)) ||
                    (c.position && c.position.toLowerCase().includes(searchTerm));
                
                const matchGroup = groupFilter === 'all' || (c.group && c.group === groupFilter);
                
                return matchSearch && matchGroup;
            });
            
            const allSelected = filtered.every(c => selectedCustomersData[c.id]);
            
            if (allSelected) {
                // 모두 선택 해제
                filtered.forEach(c => delete selectedCustomersData[c.id]);
            } else {
                // 모두 선택
                filtered.forEach(c => selectedCustomersData[c.id] = c);
            }
            
            renderCustomersForSend();
        }

        function clearSelection() {
            selectedCustomersData = {};
            renderCustomersForSend();
        }

        
        function updateGroupSelectForSend() {
            // 그룹 필터 드롭다운 업데이트
            const filterSelect = document.getElementById('groupFilterSend');
            if (filterSelect) {
                filterSelect.innerHTML = '<option value="all">전체 그룹</option>' + 
                    customerGroups.map(g => {
                        const count = customers.filter(c => c.group === g).length;
                        return `<option value="${g}">${g} (${count}명)</option>`;
                    }).join('');
            }
        }

        function updateSelectedInfo() {
            const count = Object.keys(selectedCustomersData).length;
            const info = document.getElementById('selectedCustomersInfo');
            const countEl = document.getElementById('selectedCount');
            
            if (count > 0) {
                info.style.display = 'flex';
                countEl.textContent = `${count}명`;
            } else {
                info.style.display = 'none';
            }
        }

        // 이름 미리보기 업데이트 함수
        function updateNamePreview() {
            const name = document.getElementById('customerName')?.value || '이름';
            const position = document.getElementById('customerPosition')?.value || '';
            const honorific = document.getElementById('customerHonorific')?.value || '';
            const usePosition = document.getElementById('usePosition')?.checked || false;
            const useHonorific = document.getElementById('useHonorific')?.checked || false;
            
            let displayName = name;
            
            if (usePosition && position) {
                displayName += ' ' + position;
            }
            
            if (useHonorific && honorific) {
                displayName += honorific;
            }
            
            const preview = document.getElementById('namePreview');
            if (preview) {
                preview.textContent = displayName || '이름을 입력하세요';
            }
        }

        function openCustomerModal(customerId = null) {
            const modal = document.getElementById('customerModal');
            const title = document.getElementById('customerModalTitle');
            const form = document.getElementById('customerForm');
            
            form.reset();
            
            // 그룹 옵션 업데이트
            const groupSelect = document.getElementById('editGroup');
            if (groupSelect) {
                groupSelect.innerHTML = '<option value="">그룹 없음</option>' + 
                    customerGroups.map(g => `<option value="${g}">${g}</option>`).join('') +
                    '<option value="__custom__">➕ 직접 입력</option>';
            }
            
            if (customerId) {
                const customer = customers.find(c => c.id === customerId);
                if (!customer) return;
                
                title.textContent = '👤 고객 수정';
                document.getElementById('customerId').value = customer.id;
                document.getElementById('customerName').value = customer.name || '';
                document.getElementById('customerCompany').value = customer.company || '';
                document.getElementById('customerPosition').value = customer.position || '';
                
                // 전화번호 분리 (010-1234-5678 → 1234, 5678)
                if (customer.phone) {
                    const phoneParts = customer.phone.replace(/^010-?/, '').split('-');
                    document.getElementById('customerPhone1').value = phoneParts[0] || '';
                    document.getElementById('customerPhone2').value = phoneParts[1] || '';
                } else {
                    document.getElementById('customerPhone1').value = '';
                    document.getElementById('customerPhone2').value = '';
                }
                
                // 이메일 분리 (user@domain.com → user, domain.com)
                if (customer.email && customer.email.includes('@')) {
                    const [emailId, emailDomain] = customer.email.split('@');
                    document.getElementById('customerEmailId').value = emailId;
                    
                    const domainSelect = document.getElementById('customerEmailDomain');
                    const commonDomains = ['gmail.com', 'naver.com', 'daum.net', 'hanmail.net', 'kakao.com', 'nate.com'];
                    if (commonDomains.includes(emailDomain)) {
                        domainSelect.value = emailDomain;
                        document.getElementById('customEmailDomain').style.display = 'none';
                    } else {
                        domainSelect.value = '__custom__';
                        document.getElementById('customEmailDomain').value = emailDomain;
                        document.getElementById('customEmailDomain').style.display = 'block';
                    }
                } else {
                    document.getElementById('customerEmailId').value = '';
                    document.getElementById('customerEmailDomain').value = '';
                    document.getElementById('customEmailDomain').style.display = 'none';
                }
                
                document.getElementById('customerBirth').value = customer.birth || '';
                document.getElementById('customerAnniversary').value = customer.anniversary || '';
                
                // 호칭 관련 필드 불러오기
                document.getElementById('customerHonorific').value = customer.honorific || '';
                document.getElementById('usePosition').checked = customer.usePosition || false;
                document.getElementById('useHonorific').checked = customer.useHonorific || false;
                
                document.getElementById('customerTags').value = customer.tags ? customer.tags.join(', ') : '';
                document.getElementById('customerMemo').value = customer.memo || '';
                
                // 그룹 불러오기
                if (groupSelect && customer.group) {
                    const groupExists = Array.from(groupSelect.options).some(opt => opt.value === customer.group);
                    if (groupExists) {
                        groupSelect.value = customer.group;
                        document.getElementById('customGroupInput').style.display = 'none';
                    } else {
                        groupSelect.value = '__custom__';
                        document.getElementById('customGroupInput').value = customer.group;
                        document.getElementById('customGroupInput').style.display = 'block';
                    }
                }
                
                // 미리보기 업데이트
                updateNamePreview();
            } else {
                title.textContent = '👤 고객 추가';
                // 초기화
                document.getElementById('customerPhone1').value = '';
                document.getElementById('customerPhone2').value = '';
                document.getElementById('customerEmailId').value = '';
                document.getElementById('customerEmailDomain').value = '';
                document.getElementById('customEmailDomain').style.display = 'none';
                document.getElementById('customGroupInput').style.display = 'none';
                
                // 기본값 설정
                document.getElementById('usePosition').checked = false;
                document.getElementById('useHonorific').checked = false;
                updateNamePreview();
            }
            
            modal.classList.add('active');
        }

        function closeCustomerModal() {
            document.getElementById('customerModal').classList.remove('active');
        }

        // 그룹 직접 입력 토글
        function toggleCustomGroupInput() {
            const groupSelect = document.getElementById('editGroup');
            const customInput = document.getElementById('customGroupInput');
            
            if (groupSelect.value === '__custom__') {
                customInput.style.display = 'block';
                customInput.focus();
            } else {
                customInput.style.display = 'none';
                customInput.value = '';
            }
        }

        // 이메일 도메인 직접 입력 토글
        function toggleCustomEmailDomain() {
            const domainSelect = document.getElementById('customerEmailDomain');
            const customDomain = document.getElementById('customEmailDomain');
            
            if (domainSelect.value === '__custom__') {
                customDomain.style.display = 'block';
                customDomain.focus();
            } else {
                customDomain.style.display = 'none';
                customDomain.value = '';
            }
        }

        function editCustomer(customerId) {
            openCustomerModal(customerId);
        }

        async function saveCustomer(e) {
            e.preventDefault();
            
            // 중복 저장 방지
            const saveBtn = e.target.querySelector('button[type="submit"]');
            if (saveBtn && saveBtn.disabled) {
                console.log('이미 저장 중입니다.');
                return;
            }
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.textContent = '저장 중...';
            }
            
            try {
                const id = document.getElementById('customerId').value || Date.now().toString();
                const name = document.getElementById('customerName').value.trim();
                const company = document.getElementById('customerCompany').value.trim();
                const position = document.getElementById('customerPosition').value.trim();
                
                // 전화번호 처리 - 하이픈 자동 추가
                const phone1 = document.getElementById('customerPhone1').value.trim();
                const phone2 = document.getElementById('customerPhone2').value.trim();
                let phone = '';
                
                if (phone1 && phone2) {
                    phone = `010-${phone1}-${phone2}`;
                } else if (phone1) {
                    // 전체 번호가 한 필드에 입력된 경우 (하이픈 자동 추가)
                    const fullNumber = phone1.replace(/[^0-9]/g, '');
                    if (fullNumber.length === 11) {
                        phone = `${fullNumber.slice(0,3)}-${fullNumber.slice(3,7)}-${fullNumber.slice(7)}`;
                    } else {
                        phone = phone1;
                    }
                }
                
                // 이메일 합치기 (ID@도메인)
                const emailId = document.getElementById('customerEmailId').value.trim();
                let emailDomain = document.getElementById('customerEmailDomain').value;
                if (emailDomain === '__custom__') {
                    emailDomain = document.getElementById('customEmailDomain').value.trim();
                }
                const email = (emailId && emailDomain) ? `${emailId}@${emailDomain}` : '';
                
                const birth = document.getElementById('customerBirth').value;
                const anniversary = document.getElementById('customerAnniversary').value;
                
                // 호칭 관련 필드
                const honorific = document.getElementById('customerHonorific').value.trim();
                const usePosition = document.getElementById('usePosition').checked;
                const useHonorific = document.getElementById('useHonorific').checked;
                
                const tagsInput = document.getElementById('customerTags').value;
                const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(t => t) : [];
                const memo = document.getElementById('customerMemo').value.trim();
                
                // 그룹 처리 (직접 입력 지원)
                let group = document.getElementById('editGroup')?.value || '';
                if (group === '__custom__') {
                    group = document.getElementById('customGroupInput').value.trim();
                }
                
                const customer = {
                    id,
                    name,
                    company,
                    position,
                    phone,
                    email,
                    birth,
                    anniversary,
                    honorific,
                    usePosition,
                    useHonorific,
                    tags,
                    memo,
                    updatedAt: new Date().toISOString()
                };
                
                // 그룹이 있으면 추가
                if (group) {
                    customer.group = group;
                }
                
                const existingIndex = customers.findIndex(c => c.id === id);
                if (existingIndex >= 0) {
                    customers[existingIndex] = customer;
                } else {
                    customer.createdAt = new Date().toISOString();
                    customers.push(customer);
                }
                
                await saveToDrive(FILES.customers, customers);
                closeCustomerModal();
                renderCustomers();
                renderCustomersForSend();
                updateStats();
                
                showAlert('고객 정보가 저장되었습니다!', 'success');
            } catch (error) {
                console.error('저장 오류:', error);
                showAlert('저장에 실패했습니다: ' + error.message, 'error');
            } finally {
                // 버튼 다시 활성화
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = '저장';
                }
            }
        }

        // ===== 고객 삭제 관련 함수들 =====
        
        // 체크박스 선택/해제
        function toggleCustomerForDelete(customerId) {
            const index = selectedCustomersForDelete.indexOf(customerId);
            if (index > -1) {
                selectedCustomersForDelete.splice(index, 1);
            } else {
                selectedCustomersForDelete.push(customerId);
            }
            renderCustomers();
        }
        
        // 개별 고객 삭제
        async function deleteCustomer(customerId) {
            const customer = customers.find(c => c.id === customerId);
            if (!customer) return;
            
            if (!confirm(`"${customer.name}"님을 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`)) {
                return;
            }
            
            customers = customers.filter(c => c.id !== customerId);
            selectedCustomersForDelete = selectedCustomersForDelete.filter(id => id !== customerId);
            
            await saveToDrive(FILES.customers, customers);
            renderCustomers();
            renderCustomersForSend();
            updateStats();
            
            showAlert(`✅ "${customer.name}"님이 삭제되었습니다.`, 'success');
        }
        
        // 선택 삭제
        async function deleteSelectedCustomers() {
            if (selectedCustomersForDelete.length === 0) {
                showAlert('ℹ️ 삭제할 고객을 선택해주세요.', 'info');
                return;
            }
            
            const selectedNames = customers
                .filter(c => selectedCustomersForDelete.includes(c.id))
                .map(c => c.name)
                .join(', ');
            
            if (!confirm(`⚠️ 선택한 ${selectedCustomersForDelete.length}명의 고객을 삭제하시겠습니까?\n\n${selectedNames}\n\n이 작업은 되돌릴 수 없습니다.`)) {
                return;
            }
            
            const count = selectedCustomersForDelete.length;
            customers = customers.filter(c => !selectedCustomersForDelete.includes(c.id));
            selectedCustomersForDelete = [];
            
            await saveToDrive(FILES.customers, customers);
            renderCustomers();
            renderCustomersForSend();
            updateStats();
            
            showAlert(`✅ ${count}명의 고객이 삭제되었습니다.`, 'success');
        }
        
        // 일괄 삭제 (전체 삭제)
        async function clearAllCustomers() {
            if (customers.length === 0) {
                showAlert('ℹ️ 삭제할 고객이 없습니다.', 'info');
                return;
            }
            
            if (!confirm(`⚠️ 모든 고객 정보(${customers.length}명)를 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`)) {
                return;
            }
            
            if (!confirm('정말로 모든 고객을 삭제하시겠습니까?')) {
                return;
            }
            
            const count = customers.length;
            customers = [];
            selectedCustomersForDelete = [];
            
            await saveToDrive(FILES.customers, customers);
            renderCustomers();
            renderCustomersForSend();
            updateStats();
            
            showAlert(`✅ 모든 고객(${count}명)이 삭제되었습니다.`, 'success');
        }
        
        // ===== 고객 가져오기 =====
        function importCustomers() {
            // 텍스트 입력 모달 열기
            openModal('textModal');
        }
        
        // ===== 선택한 고객들에게 푸시 전송 =====
        function sendPushToSelectedCustomers() {
            if (selectedCustomersForDelete.length === 0) {
                showAlert('ℹ️ 푸시를 보낼 고객을 선택해주세요.', 'info');
                return;
            }
            
            // 선택된 고객들을 발송 탭의 선택 목록에 추가
            selectedCustomersForDelete.forEach(customerId => {
                const customer = customers.find(c => c.id === customerId);
                if (customer) {
                    selectedCustomersData[customerId] = customer;
                }
            });
            
            // 발송 탭으로 이동
            switchTab('send', document.querySelector('[onclick*="send"]'));
            
            showAlert(`✅ ${selectedCustomersForDelete.length}명의 고객이 발송 대상으로 선택되었습니다.\n메시지를 작성하고 발송하세요!`, 'success');
            
            // 선택 초기화
            selectedCustomersForDelete = [];
            renderCustomers();
        }
        
        // ===== 개별 고객에게 푸시 전송 =====
        function sendPushToCustomer(customerId) {
            const customer = customers.find(c => c.id === customerId);
            if (!customer) return;
            
            // 발송 탭의 선택 목록에 추가
            selectedCustomersData[customerId] = customer;
            
            // 발송 탭으로 이동
            switchTab('send', document.querySelector('[onclick*="send"]'));
            
            showAlert(`✅ "${customer.name}"님이 발송 대상으로 선택되었습니다.\n메시지를 작성하고 발송하세요!`, 'success');
        }

        // ================================================================
        // 기념일 자동발송 시스템
        // ================================================================
        
        let anniversaries = [];
        
        // 기념일 메시지 템플릿
        const anniversaryTemplates = {
            // 개인 기념일
            'birthday': {
                title: '{honorific}, 생일을 진심으로 축하드립니다! 🎂',
                content: `{honorific}, 생일을 진심으로 축하드립니다! 🎂

항상 건강하시고 하시는 일 모두 잘 되시길 바랍니다.

- KFPC {consultant} 드림`
            },
            'wedding': {
                title: '{honorific}, 결혼기념일을 축하드립니다! 💒',
                content: `{honorific}, 결혼기념일을 축하드립니다! 💒

부부 금슬 좋으시고 항상 행복하시길 기원합니다.

- KFPC {consultant} 드림`
            },
            'company': {
                title: '{honorific}, 창립기념일을 축하드립니다! 🏢',
                content: `{honorific}, {company} 창립기념일을 축하드립니다! 🏢

앞으로도 번창하시고 더욱 발전하시길 기원합니다.

- KFPC {consultant} 드림`
            },
            'custom': {
                title: '{honorific}, 특별한 날을 축하드립니다! 🎉',
                content: `{honorific}, 특별한 날을 축하드립니다! 🎉

뜻깊은 하루 보내시길 바랍니다.

- KFPC {consultant} 드림`
            },
            
            // 일회성 이벤트
            'promotion': {
                title: '{honorific}, 승진을 축하드립니다! 🎉',
                content: `{honorific}, 승진을 축하드립니다! 🎉

그동안의 노력이 결실을 맺었네요.
앞으로도 더욱 빛나는 활약 기대하겠습니다.

- KFPC {consultant} 드림`
            },
            'admission': {
                title: '{honorific}, 입학을 축하드립니다! 🎓',
                content: `{honorific}, 입학을 축하드립니다! 🎓

새로운 시작을 응원합니다.
배움의 즐거움이 가득하시길 바랍니다.

- KFPC {consultant} 드림`
            },
            'pass': {
                title: '{honorific}, 합격을 축하드립니다! ✅',
                content: `{honorific}, 합격을 축하드립니다! ✅

노력한 만큼의 좋은 결과를 얻으셨네요.
진심으로 축하드립니다!

- KFPC {consultant} 드림`
            },
            'moving': {
                title: '{honorific}, 이사를 축하드립니다! 🏠',
                content: `{honorific}, 이사를 축하드립니다! 🏠

새 보금자리에서 행복한 날들 가득하시길 바랍니다.

- KFPC {consultant} 드림`
            },
            'opening': {
                title: '{honorific}, 개업을 축하드립니다! 🎊',
                content: `{honorific}, 개업을 축하드립니다! 🎊

번창하시고 큰 성공 거두시길 기원합니다.

- KFPC {consultant} 드림`
            },
            
            // 음력 명절
            'lunar-new-year': {
                title: '{honorific}, 새해 복 많이 받으세요! 🧧',
                content: `{honorific}, 새해 복 많이 받으세요! 🧧

가족 모두 건강하시고 소망하시는 일 모두 이루어지시길 바랍니다.

- KFPC {consultant} 드림`
            },
            'chuseok': {
                title: '{honorific}, 추석 명절 잘 보내세요! 🌕',
                content: `{honorific}, 추석 명절 잘 보내세요! 🌕

가족 모두 건강하시고 행복한 한가위 되시길 바랍니다.

- KFPC {consultant} 드림`
            },
            
            // 기타 명절
            'christmas': {
                title: '{honorific}, 메리 크리스마스! 🎄',
                content: `{honorific}, 메리 크리스마스! 🎄

따뜻하고 행복한 성탄절 보내시길 바랍니다.

- KFPC {consultant} 드림`
            },
            'new-year': {
                title: '{honorific}, 새해 복 많이 받으세요! 🎆',
                content: `{honorific}, 새해 복 많이 받으세요! 🎆

건강하시고 뜻하시는 일 모두 이루어지는 한 해 되시길 기원합니다.

- KFPC {consultant} 드림`
            },
            
            // 24절기
            'solar-ipchun': {
                title: '{honorific}, 입춘을 맞이하여 인사드립니다 🌱',
                content: `{honorific}, 입춘을 맞이하여 인사드립니다 🌱

봄의 시작과 함께 새로운 활력이 가득하시길 바랍니다.

- KFPC {consultant} 드림`
            },
            'solar-chunbun': {
                title: '{honorific}, 춘분 절기 인사드립니다 🌸',
                content: `{honorific}, 춘분 절기 인사드립니다 🌸

화창한 봄날처럼 기쁜 일 가득하시길 바랍니다.

- KFPC {consultant} 드림`
            },
            'solar-ipha': {
                title: '{honorific}, 입하 절기 인사드립니다 ☀️',
                content: `{honorific}, 입하 절기 인사드립니다 ☀️

여름의 시작과 함께 건강 유의하시길 바랍니다.

- KFPC {consultant} 드림`
            },
            'solar-haaji': {
                title: '{honorific}, 하지 절기 인사드립니다 🌞',
                content: `{honorific}, 하지 절기 인사드립니다 🌞

무더위 건강 조심하시고 활기찬 여름 보내세요.

- KFPC {consultant} 드림`
            },
            'solar-ipchu': {
                title: '{honorific}, 입추 절기 인사드립니다 🍂',
                content: `{honorific}, 입추 절기 인사드립니다 🍂

가을의 시작, 풍성한 계절 되시길 바랍니다.

- KFPC {consultant} 드림`
            },
            'solar-chubun': {
                title: '{honorific}, 추분 절기 인사드립니다 🍁',
                content: `{honorific}, 추분 절기 인사드립니다 🍁

황금빛 가을처럼 풍요로운 날들 되시길 기원합니다.

- KFPC {consultant} 드림`
            },
            'solar-ipdong': {
                title: '{honorific}, 입동 절기 인사드립니다 ❄️',
                content: `{honorific}, 입동 절기 인사드립니다 ❄️

겨울 건강 잘 챙기시고 따뜻한 연말 보내세요.

- KFPC {consultant} 드림`
            },
            'solar-dongji': {
                title: '{honorific}, 동지 절기 인사드립니다 ⛄',
                content: `{honorific}, 동지 절기 인사드립니다 ⛄

팥죽 드시고 무병장수 하시길 바랍니다.

- KFPC {consultant} 드림`
            }
        };
        
        // 기념일 유형 정보
        const anniversaryTypeInfo = {
            'birthday': { name: '생일', icon: '🎂', category: 'personal', defaultRepeat: 'yearly' },
            'wedding': { name: '결혼기념일', icon: '💒', category: 'personal', defaultRepeat: 'yearly' },
            'company': { name: '회사 창립일', icon: '🏢', category: 'personal', defaultRepeat: 'yearly' },
            'custom': { name: '기타 기념일', icon: '📅', category: 'personal', defaultRepeat: 'yearly' },
            'promotion': { name: '승진', icon: '🎉', category: 'onetime', defaultRepeat: 'once' },
            'admission': { name: '입학', icon: '🎓', category: 'onetime', defaultRepeat: 'once' },
            'pass': { name: '합격', icon: '✅', category: 'onetime', defaultRepeat: 'once' },
            'moving': { name: '이사', icon: '🏠', category: 'onetime', defaultRepeat: 'once' },
            'opening': { name: '개업', icon: '🎊', category: 'onetime', defaultRepeat: 'once' },
            'lunar-new-year': { name: '설날 (구정)', icon: '🧧', category: 'holiday', defaultRepeat: 'yearly', lunar: true },
            'chuseok': { name: '추석', icon: '🌕', category: 'holiday', defaultRepeat: 'yearly', lunar: true },
            'christmas': { name: '크리스마스', icon: '🎄', category: 'holiday', defaultRepeat: 'yearly', fixedDate: '12-25' },
            'new-year': { name: '신정', icon: '🎆', category: 'holiday', defaultRepeat: 'yearly', fixedDate: '01-01' },
            'solar-ipchun': { name: '입춘', icon: '🌱', category: 'solar', defaultRepeat: 'yearly', solar: true },
            'solar-chunbun': { name: '춘분', icon: '🌸', category: 'solar', defaultRepeat: 'yearly', solar: true },
            'solar-ipha': { name: '입하', icon: '☀️', category: 'solar', defaultRepeat: 'yearly', solar: true },
            'solar-haaji': { name: '하지', icon: '🌞', category: 'solar', defaultRepeat: 'yearly', solar: true },
            'solar-ipchu': { name: '입추', icon: '🍂', category: 'solar', defaultRepeat: 'yearly', solar: true },
            'solar-chubun': { name: '추분', icon: '🍁', category: 'solar', defaultRepeat: 'yearly', solar: true },
            'solar-ipdong': { name: '입동', icon: '❄️', category: 'solar', defaultRepeat: 'yearly', solar: true },
            'solar-dongji': { name: '동지', icon: '⛄', category: 'solar', defaultRepeat: 'yearly', solar: true }
        };
        
        // ===== 음력-양력 변환 함수 =====
        function lunarToSolar(year, month, day) {
            // 간단한 음력-양력 변환 (2024-2035년 설날/추석 데이터)
            const lunarDates = {
                'lunar-new-year': {
                    2024: '02-10', 2025: '01-29', 2026: '02-17', 2027: '02-06',
                    2028: '01-26', 2029: '02-13', 2030: '02-03', 2031: '01-23',
                    2032: '02-11', 2033: '01-31', 2034: '02-19', 2035: '02-08'
                },
                'chuseok': {
                    2024: '09-17', 2025: '10-06', 2026: '09-25', 2027: '09-15',
                    2028: '10-03', 2029: '09-22', 2030: '09-12', 2031: '10-01',
                    2032: '09-19', 2033: '09-08', 2034: '09-28', 2035: '09-17'
                }
            };
            return lunarDates;
        }
        
        // ===== 24절기 계산 함수 =====
        function calculateSolarTerm(year, termType) {
            // 24절기 양력 날짜 (대략적인 값)
            const solarTerms = {
                'solar-ipchun': { month: 2, day: 4 },      // 입춘: 2월 4일경
                'solar-chunbun': { month: 3, day: 21 },    // 춘분: 3월 21일경
                'solar-ipha': { month: 5, day: 6 },        // 입하: 5월 6일경
                'solar-haaji': { month: 6, day: 21 },      // 하지: 6월 21일경
                'solar-ipchu': { month: 8, day: 8 },       // 입추: 8월 8일경
                'solar-chubun': { month: 9, day: 23 },     // 추분: 9월 23일경
                'solar-ipdong': { month: 11, day: 7 },     // 입동: 11월 7일경
                'solar-dongji': { month: 12, day: 22 }     // 동지: 12월 22일경
            };
            
            const term = solarTerms[termType];
            if (!term) return null;
            
            return `${year}-${String(term.month).padStart(2, '0')}-${String(term.day).padStart(2, '0')}`;
        }
        
        // ===== 기념일 날짜 계산 =====
        function calculateAnniversaryDate(anniversary, year) {
            const info = anniversaryTypeInfo[anniversary.type];
            
            // 음력 명절
            if (info.lunar) {
                const lunarDates = lunarToSolar();
                return lunarDates[anniversary.type][year] || null;
            }
            
            // 24절기
            if (info.solar) {
                return calculateSolarTerm(year, anniversary.type);
            }
            
            // 고정 날짜 (크리스마스, 신정)
            if (info.fixedDate) {
                return `${year}-${info.fixedDate}`;
            }
            
            // 개인 기념일 (년도만 변경)
            if (anniversary.date) {
                const [_, month, day] = anniversary.date.split('-');
                return `${year}-${month}-${day}`;
            }
            
            return null;
        }
        
        // ===== 기념일 저장/로드 =====
        async function saveAnniversaries() {
            try {
                localStorage.setItem('kfpc_anniversaries', JSON.stringify(anniversaries));
                await saveToDrive('anniversaries.fmd', anniversaries);
            } catch (error) {
                console.error('기념일 저장 실패:', error);
            }
        }
        
        async function loadAnniversaries() {
            try {
                const data = await loadFromDrive('anniversaries.fmd');
                if (data) {
                    anniversaries = data;
                } else {
                    const local = localStorage.getItem('kfpc_anniversaries');
                    if (local) anniversaries = JSON.parse(local);
                }
            } catch (error) {
                console.error('기념일 로드 실패:', error);
            }
            renderAnniversaries();
            updateAnniversaryStats();
        }
        
        // ===== 기념일 모달 열기 =====
        function openAnniversaryModal(anniversaryId = null) {
            const modal = document.getElementById('anniversaryModal');
            const title = document.getElementById('anniversaryModalTitle');
            const form = document.getElementById('anniversaryForm');
            
            form.reset();
            
            // 고객 목록 업데이트
            const customerSelect = document.getElementById('anniversaryCustomer');
            customerSelect.innerHTML = '<option value="">선택하세요</option>' +
                customers.map(c => `<option value="${c.id}">${c.name}${c.company ? ' (' + c.company + ')' : ''}</option>`).join('');
            
            // 템플릿 목록 업데이트
            updateTemplateOptions();
            
            if (anniversaryId) {
                const anniversary = anniversaries.find(a => a.id === anniversaryId);
                if (!anniversary) return;
                
                title.textContent = '📅 기념일 수정';
                document.getElementById('anniversaryId').value = anniversary.id;
                document.getElementById('anniversaryCustomer').value = anniversary.customerId;
                document.getElementById('anniversaryType').value = anniversary.type;
                document.getElementById('anniversaryDate').value = anniversary.date || '';
                document.querySelector(`input[name="anniversaryTiming"][value="${anniversary.timing}"]`).checked = true;
                document.getElementById('anniversarySendTime').value = anniversary.sendTime;
                document.querySelector(`input[name="anniversaryRepeat"][value="${anniversary.repeat}"]`).checked = true;
                document.getElementById('anniversaryTitle').value = anniversary.title;
                document.getElementById('anniversaryContent').value = anniversary.content;
                if (anniversary.link) {
                    document.getElementById('anniversaryLink').value = anniversary.link;
                }
                if (anniversary.image) {
                    document.getElementById('anniversaryImage').value = anniversary.image;
                }
                document.getElementById('anniversaryActive').checked = anniversary.active !== false;
                
                if (anniversary.repeat === 'yearly') {
                    document.getElementById('repeatEndGroup').style.display = 'block';
                    if (anniversary.repeatUnlimited) {
                        document.getElementById('repeatUnlimited').checked = true;
                        document.getElementById('repeatEndDateGroup').style.display = 'none';
                    } else if (anniversary.repeatEndDate) {
                        document.getElementById('repeatEndDate').value = anniversary.repeatEndDate;
                    }
                }
            } else {
                title.textContent = '📅 기념일 추가';
                document.getElementById('anniversarySendTime').value = '09:00';
            }
            
            updateAnniversaryForm();
            modal.classList.add('active');
        }
        
        function closeAnniversaryModal() {
            document.getElementById('anniversaryModal').classList.remove('active');
        }
        
        // ===== 기념일 폼 업데이트 =====
        function updateAnniversaryForm() {
            const type = document.getElementById('anniversaryType').value;
            const info = anniversaryTypeInfo[type];
            const dateGroup = document.getElementById('anniversaryDateGroup');
            const repeatGroup = document.getElementById('anniversaryRepeatGroup');
            const dateInput = document.getElementById('anniversaryDate');
            const dateHint = document.getElementById('anniversaryDateHint');
            
            // 개인 기념일만 날짜 입력 표시
            if (info && (info.category === 'personal' || info.category === 'onetime')) {
                dateGroup.style.display = 'block';
                dateInput.required = true;
                
                if (info.category === 'onetime') {
                    dateHint.textContent = '일회성 이벤트 날짜를 선택하세요';
                } else {
                    dateHint.textContent = '매년 반복될 기념일 날짜를 선택하세요';
                }
            } else {
                dateGroup.style.display = 'none';
                dateInput.required = false;
            }
            
            // 일회성 이벤트는 반복 설정 자동 조정
            if (info && info.defaultRepeat === 'once') {
                document.querySelector('input[name="anniversaryRepeat"][value="once"]').checked = true;
                toggleRepeatEnd();
            }
        }
        
        // ===== 템플릿 옵션 업데이트 =====
        function updateTemplateOptions() {
            const select = document.getElementById('anniversaryTemplate');
            const type = document.getElementById('anniversaryType').value;
            
            select.innerHTML = '<option value="">직접 작성</option>';
            
            if (type && anniversaryTemplates[type]) {
                select.innerHTML += `<option value="${type}">기본 템플릿</option>`;
            }
        }
        
        // ===== 템플릿 로드 =====
        function loadAnniversaryTemplate() {
            const templateValue = document.getElementById('anniversaryTemplate').value;
            if (!templateValue || templateValue === '') return;
            
            const template = anniversaryTemplates[templateValue];
            if (template) {
                document.getElementById('anniversaryTitle').value = template.title;
                document.getElementById('anniversaryContent').value = template.content;
            }
        }
        
        // ===== 반복 종료일 토글 =====
        function toggleRepeatEnd() {
            const repeat = document.querySelector('input[name="anniversaryRepeat"]:checked').value;
            const endGroup = document.getElementById('repeatEndGroup');
            
            if (repeat === 'yearly') {
                endGroup.style.display = 'block';
            } else {
                endGroup.style.display = 'none';
            }
        }
        
        function toggleRepeatEndDate() {
            const unlimited = document.getElementById('repeatUnlimited').checked;
            const dateGroup = document.getElementById('repeatEndDateGroup');
            
            if (unlimited) {
                dateGroup.style.display = 'none';
                document.getElementById('repeatEndDate').value = '';
            } else {
                dateGroup.style.display = 'block';
            }
        }
        
        // ===== 기념일 저장 =====
        async function saveAnniversary(e) {
            e.preventDefault();
            
            const id = document.getElementById('anniversaryId').value || Date.now().toString();
            const customerId = document.getElementById('anniversaryCustomer').value;
            const customer = customers.find(c => c.id === customerId);
            
            if (!customer) {
                showAlert('고객을 선택해주세요.', 'error');
                return;
            }
            
            const type = document.getElementById('anniversaryType').value;
            const timing = document.querySelector('input[name="anniversaryTiming"]:checked').value;
            const repeat = document.querySelector('input[name="anniversaryRepeat"]:checked').value;
            
            const anniversary = {
                id,
                customerId,
                customerName: customer.name,
                type,
                date: document.getElementById('anniversaryDate').value || null,
                timing,
                sendTime: document.getElementById('anniversarySendTime').value,
                repeat,
                repeatUnlimited: repeat === 'yearly' && document.getElementById('repeatUnlimited').checked,
                repeatEndDate: repeat === 'yearly' && !document.getElementById('repeatUnlimited').checked ? 
                    document.getElementById('repeatEndDate').value : null,
                title: document.getElementById('anniversaryTitle').value,
                content: document.getElementById('anniversaryContent').value,
                link: document.getElementById('anniversaryLink')?.value.trim() || null,
                image: document.getElementById('anniversaryImage')?.value.trim() || null,
                active: document.getElementById('anniversaryActive').checked,
                createdAt: new Date().toISOString()
            };
            
            const existingIndex = anniversaries.findIndex(a => a.id === id);
            if (existingIndex >= 0) {
                anniversaries[existingIndex] = { ...anniversaries[existingIndex], ...anniversary, updatedAt: new Date().toISOString() };
            } else {
                anniversaries.push(anniversary);
            }
            
            await saveAnniversaries();
            closeAnniversaryModal();
            renderAnniversaries();
            updateAnniversaryStats();
            
            showAlert('기념일이 저장되었습니다!', 'success');
        }
        
        // ===== 기념일 삭제 =====
        async function deleteAnniversary(id) {
            const anniversary = anniversaries.find(a => a.id === id);
            if (!anniversary) return;
            
            if (!confirm(`"${anniversary.customerName}님의 ${anniversaryTypeInfo[anniversary.type].name}" 기념일을 삭제하시겠습니까?`)) {
                return;
            }
            
            anniversaries = anniversaries.filter(a => a.id !== id);
            await saveAnniversaries();
            renderAnniversaries();
            updateAnniversaryStats();
            
            showAlert('기념일이 삭제되었습니다.', 'success');
        }
        
        // ===== 기념일 활성화/비활성화 =====
        async function toggleAnniversaryActive(id) {
            const anniversary = anniversaries.find(a => a.id === id);
            if (!anniversary) return;
            
            anniversary.active = !anniversary.active;
            await saveAnniversaries();
            renderAnniversaries();
            updateAnniversaryStats();
        }
        
        // ===== 기념일 목록 렌더링 =====
        function renderAnniversaries() {
            const container = document.getElementById('anniversaryList');
            const filter = document.getElementById('anniversaryFilter')?.value || 'all';
            const search = document.getElementById('anniversarySearch')?.value.toLowerCase() || '';
            
            let filtered = anniversaries.filter(a => {
                const matchSearch = !search || 
                    a.customerName.toLowerCase().includes(search) ||
                    anniversaryTypeInfo[a.type].name.toLowerCase().includes(search);
                
                if (!matchSearch) return false;
                
                switch(filter) {
                    case 'active': return a.active !== false;
                    case 'inactive': return a.active === false;
                    case 'personal': return ['personal', 'onetime'].includes(anniversaryTypeInfo[a.type].category);
                    case 'holiday': return ['holiday', 'solar'].includes(anniversaryTypeInfo[a.type].category);
                    case 'upcoming': return isUpcoming(a);
                    default: return true;
                }
            });
            
            if (filtered.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 60px 20px; opacity: 0.7;">
                        <div style="font-size: 48px; margin-bottom: 15px;">📅</div>
                        <div style="font-size: 16px;">등록된 기념일이 없습니다</div>
                        <div style="font-size: 14px; margin-top: 10px;">+ 기념일 추가 버튼을 눌러 시작하세요</div>
                    </div>
                `;
                return;
            }
            
            container.innerHTML = `
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: rgba(255,255,255,0.1); border-bottom: 2px solid rgba(255,255,255,0.2);">
                            <th style="padding: 12px; text-align: left;">고객</th>
                            <th style="padding: 12px; text-align: left;">기념일</th>
                            <th style="padding: 12px; text-align: center;">다음 발송일</th>
                            <th style="padding: 12px; text-align: center;">발송 설정</th>
                            <th style="padding: 12px; text-align: center;">반복</th>
                            <th style="padding: 12px; text-align: center;">상태</th>
                            <th style="padding: 12px; text-align: center;">관리</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filtered.map(a => {
                            const info = anniversaryTypeInfo[a.type];
                            const nextDate = getNextAnniversaryDate(a);
                            const daysUntil = nextDate ? Math.ceil((new Date(nextDate) - new Date()) / (1000 * 60 * 60 * 24)) : null;
                            
                            return `
                                <tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">
                                    <td style="padding: 12px;">
                                        <strong>${a.customerName}</strong>
                                    </td>
                                    <td style="padding: 12px;">
                                        <div>${info.icon} ${info.name}</div>
                                        ${a.date ? `<div style="font-size: 11px; opacity: 0.7; margin-top: 3px;">${formatDate(a.date)}</div>` : ''}
                                    </td>
                                    <td style="padding: 12px; text-align: center;">
                                        ${nextDate ? `
                                            <div>${formatDate(nextDate)}</div>
                                            <div style="font-size: 11px; color: ${daysUntil <= 7 ? '#FFD700' : '#4CAF50'}; margin-top: 3px;">
                                                ${daysUntil === 0 ? '오늘!' : daysUntil === 1 ? '내일' : `D-${daysUntil}`}
                                            </div>
                                        ` : '-'}
                                    </td>
                                    <td style="padding: 12px; text-align: center; font-size: 12px;">
                                        <div>${a.timing === 'before' ? '전날' : '당일'} ${a.sendTime}</div>
                                    </td>
                                    <td style="padding: 12px; text-align: center;">
                                        <span style="padding: 4px 8px; background: rgba(255,255,255,0.1); border-radius: 4px; font-size: 11px;">
                                            ${a.repeat === 'yearly' ? (a.repeatUnlimited ? '매년 무제한' : `매년 (~${formatDate(a.repeatEndDate)})`) : '1회만'}
                                        </span>
                                    </td>
                                    <td style="padding: 12px; text-align: center;">
                                        <label style="cursor: pointer; display: inline-block;">
                                            <input type="checkbox" ${a.active !== false ? 'checked' : ''} onchange="toggleAnniversaryActive('${a.id}')" style="cursor: pointer;">
                                            <span style="font-size: 11px; margin-left: 5px;">${a.active !== false ? '활성' : '비활성'}</span>
                                        </label>
                                    </td>
                                    <td style="padding: 12px; text-align: center; white-space: nowrap;">
                                        <button onclick="openAnniversaryModal('${a.id}')" style="padding: 6px 10px; background: rgba(33,150,243,0.8); border: none; border-radius: 5px; color: white; cursor: pointer; margin-right: 5px;" title="수정">✏️</button>
                                        <button onclick="deleteAnniversary('${a.id}')" style="padding: 6px 10px; background: rgba(244,67,54,0.8); border: none; border-radius: 5px; color: white; cursor: pointer;" title="삭제">🗑️</button>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            `;
        }
        
        // ===== 다음 기념일 날짜 계산 =====
        function getNextAnniversaryDate(anniversary) {
            const today = new Date();
            const currentYear = today.getFullYear();
            
            // 올해 날짜 계산
            let thisYearDate = calculateAnniversaryDate(anniversary, currentYear);
            if (thisYearDate) {
                const thisYearDateTime = new Date(thisYearDate);
                
                // 발송 타이밍에 따라 조정
                if (anniversary.timing === 'before') {
                    thisYearDateTime.setDate(thisYearDateTime.getDate() - 1);
                }
                
                // 올해 날짜가 미래면 반환
                if (thisYearDateTime >= today) {
                    // 종료일 체크
                    if (anniversary.repeatEndDate && thisYearDate > anniversary.repeatEndDate) {
                        return null;
                    }
                    return thisYearDateTime.toISOString().split('T')[0];
                }
            }
            
            // 내년 날짜 계산 (반복인 경우)
            if (anniversary.repeat === 'yearly') {
                let nextYearDate = calculateAnniversaryDate(anniversary, currentYear + 1);
                if (nextYearDate) {
                    // 종료일 체크
                    if (anniversary.repeatEndDate && nextYearDate > anniversary.repeatEndDate) {
                        return null;
                    }
                    
                    const nextYearDateTime = new Date(nextYearDate);
                    if (anniversary.timing === 'before') {
                        nextYearDateTime.setDate(nextYearDateTime.getDate() - 1);
                    }
                    return nextYearDateTime.toISOString().split('T')[0];
                }
            }
            
            return null;
        }
        
        // ===== 다가오는 기념일 체크 =====
        function isUpcoming(anniversary) {
            const nextDate = getNextAnniversaryDate(anniversary);
            if (!nextDate) return false;
            
            const daysUntil = Math.ceil((new Date(nextDate) - new Date()) / (1000 * 60 * 60 * 24));
            return daysUntil >= 0 && daysUntil <= 30;
        }
        
        // ===== 통계 업데이트 =====
        function updateAnniversaryStats() {
            document.getElementById('anniversaryTotalCount').textContent = anniversaries.length;
            document.getElementById('anniversaryActiveCount').textContent = anniversaries.filter(a => a.active !== false).length;
            
            const today = new Date();
            const thisMonth = today.getMonth();
            const thisYear = today.getFullYear();
            
            const upcomingCount = anniversaries.filter(a => {
                if (a.active === false) return false;
                const nextDate = getNextAnniversaryDate(a);
                if (!nextDate) return false;
                const date = new Date(nextDate);
                return date.getMonth() === thisMonth && date.getFullYear() === thisYear;
            }).length;
            
            document.getElementById('anniversaryUpcomingCount').textContent = upcomingCount;
        }
        
        // ===== 날짜 포맷 =====
        function formatDate(dateStr) {
            if (!dateStr) return '-';
            const date = new Date(dateStr);
            return `${date.getMonth() + 1}월 ${date.getDate()}일`;
        }

        // ===== 메시지 발송 =====
        function validateSchedule(dtStr) {
            if (!dtStr) return false;
            const when = new Date(dtStr);
            return when.getTime() > Date.now() + 60 * 1000; // 최소 1분 이후
        }

        async function sendMessage(e) {
            e.preventDefault();
            
            const selectedIds = Object.keys(selectedCustomersData);
            if (selectedIds.length === 0) {
                showAlert('발송할 고객을 선택해주세요.', 'error');
                return;
            }
            
            const title = document.getElementById('messageTitle').value.trim();
            const body = document.getElementById('messageBody').value.trim();
            const link = document.getElementById('messageLink').value.trim();
            const image = document.getElementById('messageImage').value.trim();
            const sendType = document.getElementById('sendType').value;
            const scheduleTime = document.getElementById('scheduleTime').value;
            
            if (sendType === 'scheduled' && !validateSchedule(scheduleTime)) {
                showAlert('예약 시각은 현재 시각으로부터 최소 1분 이후로 설정해주세요.', 'error');
                return;
            }
            
            let sentCount = 0;
            
            selectedIds.forEach(id => {
                const customer = selectedCustomersData[id];
                
                // ⭐ 스마트 호칭 시스템
                function getHonorific(customer) {
                    const name = customer.name || '';
                    const position = customer.position || '';
                    const honorificType = customer.honorific || '님'; // 기본값: 님
                    
                    // 받침 체크 함수 (한글 유니코드 기반)
                    function hasFinalConsonant(text) {
                        if (!text) return false;
                        const lastChar = text.charCodeAt(text.length - 1);
                        return (lastChar - 0xAC00) % 28 !== 0;
                    }
                    
                    switch(honorificType) {
                        case '님':
                            return name + '님';
                        case '직함님':
                            return position ? position + '님' : name + '님';
                        case '고객님':
                            return name + ' 고객님';
                        case '씨':
                            return name + '씨';
                        case '아야':
                            return name + (hasFinalConsonant(name) ? '아' : '야');
                        case '이름만':
                            return name;
                        default:
                            return name + '님';
                    }
                }
                
                const personalizedBody = body
                    .replace(/{honorific}/g, getHonorific(customer))
                    .replace(/{name}/g, formatCustomerName(customer))
                    .replace(/{position}/g, customer.position || '')
                    .replace(/{company}/g, customer.company || '');
                
                const personalizedTitle = title
                    .replace(/{honorific}/g, getHonorific(customer))
                    .replace(/{name}/g, formatCustomerName(customer))
                    .replace(/{position}/g, customer.position || '')
                    .replace(/{company}/g, customer.company || '');
                
                const message = {
                    id: Date.now() + sentCount,
                    customerId: customer.id,
                    customerName: customer.name,
                    company: customer.company,
                    position: customer.position,
                    title: personalizedTitle,
                    body: personalizedBody,
                    link: link || null,
                    image: image || null,
                    originalTitle: title,
                    originalBody: body,
                    sendType: sendType,
                    scheduleTime: sendType === 'scheduled' ? scheduleTime : null,
                    status: sendType === 'scheduled' ? 'scheduled' : 'success',
                    sentAt: sendType === 'immediate' ? new Date().toISOString() : null,
                    createdAt: new Date().toISOString()
                };
                
                messages.unshift(message);
                sentCount++;
            });
            
            await saveToDrive(FILES.messages, messages);
            resetSendForm();
            selectedCustomersData = {};
            renderCustomersForSend();
            renderMessages();
            updateStats();
            
            showAlert(`✅ ${sentCount}명의 고객에게 메시지가 ${sendType === 'scheduled' ? '예약' : '발송'}되었습니다!`, 'success');
            
            switchTab('log', document.querySelectorAll('.tab-btn')[3]);
        }

        function resetSendForm() {
            document.getElementById('sendForm').reset();
            document.getElementById('scheduleGroup').classList.add('hidden');
        }

        function toggleSchedule() {
            const sendType = document.getElementById('sendType').value;
            const scheduleGroup = document.getElementById('scheduleGroup');
            
            if (sendType === 'scheduled') {
                scheduleGroup.classList.remove('hidden');
                // 현재 시각 + 1시간을 기본값으로 설정
                const now = new Date();
                now.setHours(now.getHours() + 1);
                const formatted = now.toISOString().slice(0, 16);
                document.getElementById('scheduleTime').value = formatted;
            } else {
                scheduleGroup.classList.add('hidden');
            }
        }

        // ===== 발송 로그 =====
        function renderMessages() {
            const container = document.getElementById('logContainer');
            const filter = document.getElementById('logFilter')?.value || 'all';
            const sort = document.getElementById('logSort')?.value || 'newest';
            
            let filtered = [...messages];
            
            if (filter !== 'all') {
                filtered = filtered.filter(m => m.status === filter);
            }
            
            if (sort === 'newest') {
                filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            } else {
                filtered.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
            }
            
            if (filtered.length === 0) {
                container.innerHTML = '<p style="text-align: center; opacity: 0.7; padding: 40px;">발송 내역이 없습니다</p>';
                return;
            }
            
            container.innerHTML = `
                <table class="customers-table">
                    <thead>
                        <tr>
                            <th>No</th>
                            <th>제목</th>
                            <th>내용</th>
                            <th>링크/이미지</th>
                            <th>수신자</th>
                            <th>상태</th>
                            <th>발송일시</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filtered.map((msg, index) => {
                            const statusClass = msg.status;
                            const statusText = msg.status === 'success' ? '✅ 발송 완료' : 
                                             msg.status === 'scheduled' ? '⏰ 예약 대기' : '❌ 발송 실패';
                            const dateStr = msg.sentAt ? 
                                new Date(msg.sentAt).toLocaleString('ko-KR', {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'}) : 
                                msg.scheduleTime ? 
                                `예약: ${new Date(msg.scheduleTime).toLocaleString('ko-KR', {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'})}` :
                                new Date(msg.createdAt).toLocaleString('ko-KR', {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'});
                            
                            // 링크와 이미지 표시
                            let attachments = '';
                            if (msg.link) {
                                attachments += `<div style="margin-bottom: 4px;"><a href="${msg.link}" target="_blank" style="color: #4CAF50; text-decoration: none; font-size: 12px;">🔗 링크</a></div>`;
                            }
                            if (msg.image) {
                                attachments += `<div><span style="color: #2196F3; font-size: 12px;">🖼️ 이미지</span></div>`;
                            }
                            if (!msg.link && !msg.image) {
                                attachments = '<span style="opacity: 0.5; font-size: 12px;">-</span>';
                            }
                            
                            return `
                                <tr>
                                    <td>${filtered.length - index}</td>
                                    <td><strong>${msg.title}</strong></td>
                                    <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${msg.body}</td>
                                    <td style="white-space: nowrap;">${attachments}</td>
                                    <td>${msg.customerName} ${msg.position || ''}</td>
                                    <td>
                                        <span class="log-status ${statusClass}" style="padding: 4px 8px; border-radius: 4px; font-size: 11px; white-space: nowrap;">
                                            ${statusText}
                                        </span>
                                    </td>
                                    <td style="white-space: nowrap;">${dateStr}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            `;
        }

        // ===== 템플릿 =====
        function openTemplateModal() {
            document.getElementById('templateModal').classList.add('active');
            document.getElementById('templateForm').reset();
        }

        function closeTemplateModal() {
            document.getElementById('templateModal').classList.remove('active');
        }

        async function saveTemplate(e) {
            e.preventDefault();
            
            const template = {
                id: Date.now(),
                name: document.getElementById('templateName').value.trim(),
                title: document.getElementById('templateTitle').value.trim(),
                body: document.getElementById('templateBody').value.trim(),
                link: document.getElementById('templateLink')?.value.trim() || null,
                image: document.getElementById('templateImage')?.value.trim() || null,
                createdAt: new Date().toISOString()
            };
            
            templates.push(template);
            await saveToDrive(FILES.templates, templates);
            closeTemplateModal();
            renderTemplates();
            
            showAlert('✅ 템플릿이 저장되었습니다!', 'success');
        }

        function renderTemplates() {
            const list = document.getElementById('templateList');
            
            if (templates.length === 0) {
                list.innerHTML = '<p style="text-align: center; opacity: 0.7; padding: 40px; grid-column: 1/-1;">등록된 템플릿이 없습니다</p>';
                return;
            }
            
            list.innerHTML = templates.map(template => {
                let attachmentInfo = '';
                if (template.link || template.image) {
                    attachmentInfo = '<div style="margin-top: 8px; font-size: 12px; opacity: 0.8;">';
                    if (template.link) attachmentInfo += '🔗 링크 ';
                    if (template.image) attachmentInfo += '🖼️ 이미지';
                    attachmentInfo += '</div>';
                }
                
                return `
                    <div class="template-card">
                        <div class="template-name">${template.name}</div>
                        <div class="template-preview">${template.body}</div>
                        ${attachmentInfo}
                        <div class="template-actions">
                            <button class="btn btn-secondary" onclick="useTemplate(${template.id})">사용</button>
                            <button class="btn btn-danger" onclick="deleteTemplate(${template.id})">삭제</button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        function useTemplate(id) {
            const template = templates.find(t => t.id === id);
            if (!template) return;
            
            switchTab('send', document.querySelectorAll('.tab-btn')[0]);
            document.getElementById('messageTitle').value = template.title;
            document.getElementById('messageBody').value = template.body;
            if (template.link) {
                document.getElementById('messageLink').value = template.link;
            }
            if (template.image) {
                document.getElementById('messageImage').value = template.image;
            }
            
            showAlert('템플릿이 적용되었습니다!', 'success');
        }

        async function deleteTemplate(id) {
            if (!confirm('이 템플릿을 삭제하시겠습니까?')) return;
            
            templates = templates.filter(t => t.id !== id);
            await saveToDrive(FILES.templates, templates);
            renderTemplates();
            
            showAlert('템플릿이 삭제되었습니다.', 'success');
        }

        // ===== 통계 =====
        function updateStats() {
            document.getElementById('statCustomers').textContent = customers.length;
            document.getElementById('statMessages').textContent = messages.length;
            document.getElementById('statScheduled').textContent = messages.filter(m => m.status === 'scheduled').length;
            document.getElementById('statSubscribers').textContent = pushSubscriptions.length;
        }

        // ===== 탭 전환 (버그 수정) =====
        function switchTab(tab, el) {
            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
            
            if (el) el.classList.add('active');
            
            const tabMap = {
                'send': 'sendTab',
                'scheduled': 'scheduledTab',
                'customers': 'customersTab',
                'anniversary': 'anniversaryTab',
                'log': 'logTab',
                'template': 'templateTab',
                'settings': 'settingsTab',
                'import': 'importTab'
            };
            
            const targetTab = document.getElementById(tabMap[tab]);
            if (targetTab) {
                targetTab.classList.remove('hidden');
                
                // 탭 전환 시 해당 탭의 렌더링 함수 호출
                if (tab === 'scheduled') {
                    renderScheduledMessages();
                } else if (tab === 'customers') {
                    renderCustomers();
                } else if (tab === 'log') {
                    renderMessages();
                } else if (tab === 'anniversary') {
                    renderAnniversaries();
                }
            }
        }

        // ===== 설정 =====
        function updateSettingsUI() {
            document.getElementById('quietHoursStart').value = appSettings.quietHoursStart || '21:00';
            document.getElementById('quietHoursEnd').value = appSettings.quietHoursEnd || '08:00';
            document.getElementById('lastSync').textContent = appSettings.lastSync ? 
                new Date(appSettings.lastSync).toLocaleString('ko-KR') : '-';
            
            const pushStatus = document.getElementById('pushStatus');
            if (isPushEnabled) {
                pushStatus.innerHTML = '<span style="color: #4CAF50;">✅ 푸시 알림 활성화됨</span>';
            } else {
                pushStatus.innerHTML = '<span style="color: #ff6b6b;">❌ 푸시 알림 비활성화됨</span><br><small>상단의 "🔔 알림 허용" 버튼을 클릭하여 활성화하세요.</small>';
            }
        }

        async function syncAllData() {
            showLoading(true);
            try {
                await saveToDrive(FILES.customers, customers);
                await saveToDrive(FILES.messages, messages);
                await saveToDrive(FILES.templates, templates);
                await saveToDrive(FILES.inviteCustomers, inviteCustomers);
                await saveToDrive(FILES.subscriptions, pushSubscriptions);
                
                appSettings.lastSync = new Date().toISOString();
                await saveToDrive(FILES.settings, appSettings);
                
                updateSettingsUI();
                showAlert('전체 데이터가 동기화되었습니다!', 'success');
            } catch (error) {
                console.error('동기화 오류:', error);
                showAlert('동기화에 실패했습니다.', 'error');
            } finally {
                showLoading(false);
            }
        }

        async function backupData() {
            const backup = {
                customers,
                messages,
                templates,
                pushSubscriptions,
                appSettings,
                backupDate: new Date().toISOString()
            };
            
            const encrypted = await encryptData(backup);
            const blob = new Blob([encrypted], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `kfpc_backup_${new Date().toISOString().slice(0,10)}.fmd`;
            a.click();
            URL.revokeObjectURL(url);
            
            showAlert('백업 파일이 다운로드되었습니다!', 'success');
        }

        function clearCache() {
            if (!confirm('캐시를 삭제하시겠습니까? (Drive 데이터는 유지됩니다)')) return;
            
            localStorage.removeItem('cachedCustomers');
            localStorage.removeItem('cachedMessages');
            
            showAlert('캐시가 삭제되었습니다.', 'success');
        }

        async function resetAllData() {
            if (!confirm('⚠️ 경고: 모든 데이터가 삭제됩니다. 계속하시겠습니까?')) return;
            if (!confirm('정말로 모든 데이터를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
            
            customers = [];
            messages = [];
            templates = [];
            pushSubscriptions = [];
            selectedCustomersData = {};
            
            await saveToDrive(FILES.customers, customers);
            await saveToDrive(FILES.messages, messages);
            await saveToDrive(FILES.templates, templates);
            await saveToDrive(FILES.subscriptions, pushSubscriptions);
            
            renderCustomers();
            renderCustomersForSend();
            renderMessages();
            renderTemplates();
            updateStats();
            
            showAlert('모든 데이터가 초기화되었습니다.', 'success');
        }

        // ===== 유틸리티 =====
        function showAlert(message, type = 'info') {
            const banner = document.getElementById('alertBanner');
            const messageEl = document.getElementById('alertMessage');
            
            // ⭐ 기존 타이머가 있으면 취소 (중복 알림 방지)
            if (currentAlertTimeout) {
                clearTimeout(currentAlertTimeout);
                currentAlertTimeout = null;
            }
            
            messageEl.textContent = message;
            banner.classList.add('show');
            
            // 3초 후 자동 닫기
            currentAlertTimeout = setTimeout(() => {
                closeAlert();
                currentAlertTimeout = null;
            }, 3000);
        }

        function closeAlert() {
            document.getElementById('alertBanner').classList.remove('show');
        }

        function showLoading(show) {
            const loading = document.getElementById('loadingIndicator');
            if (show) {
                loading.classList.add('show');
            } else {
                loading.classList.remove('show');
            }
        }

        function goBack() {
            if (confirm('메인으로 돌아가시겠습니까?')) {
                window.location.href = 'index.html';
            }
        }

        // ===== 초기화 =====
        async function init() {
            const savedToken = localStorage.getItem('googleAccessToken');
            if (savedToken) {
                accessToken = savedToken;
                isDriveConnected = true;
                updateDriveStatus(true);
                await loadAllData();
            } else {
                updateDriveStatus(false);
            }
            
            // 푸시 권한 확인
            if ('Notification' in window) {
                if (Notification.permission === 'granted') {
                    isPushEnabled = true;
                    updatePushStatus(true);
                }
            }
            
            updateStats();
            updateSettingsUI();
        }

        window.addEventListener('load', () => { init(); if (typeof initInvite === 'function') initInvite(); });
    
        
        // ===============================================================
        // 고객 초대 시스템 함수들 (customer-invite.html에서 통합)
        // ===============================================================
        
        // ===== 데이터 저장소 =====
        let inviteCustomers = [];
        let messageTemplate = '';
        let consultantName = '홍길동';
        
        // ===== 초기화 =====
        function initInvite() {
            loadData();
            updateInviteStats();
            renderInviteCustomers();
        }
        
        // ===== 데이터 관리 =====
        function saveInviteData() {
            localStorage.setItem('pushcustomer_invite_customers', JSON.stringify(inviteCustomers));
            
            // Google Drive에도 저장
            if (typeof saveToDrive === 'function') {
                saveToDrive();
            }
            localStorage.setItem('pushcustomer_consultant_name', consultantName);
            localStorage.setItem('pushcustomer_message_template', messageTemplate);
            updateInviteStats();
            renderInviteCustomers();
        }
        
        function loadData() {
            const savedCustomers = localStorage.getItem('pushcustomer_invite_customers');
            // 설정 탭의 consultant_name을 우선 사용, 없으면 기존 저장값 사용
            const savedName = localStorage.getItem('kfpc_consultant_name') || localStorage.getItem('pushcustomer_consultant_name');
            const savedTemplate = localStorage.getItem('pushcustomer_message_template');
            
            if (savedCustomers) inviteCustomers = JSON.parse(savedCustomers);
            if (savedName) {
                consultantName = savedName;
                document.getElementById('consultantName').value = savedName;
            }
            if (savedTemplate) {
                messageTemplate = savedTemplate;
                document.getElementById('messageTemplate').value = savedTemplate;
            } else {
                messageTemplate = document.getElementById('messageTemplate').value;
            }
        }
        
        // ===== 통계 업데이트 =====
        function updateInviteStats() {
            document.getElementById('inviteTotalCustomers').textContent = inviteCustomers.length;
            document.getElementById('inviteSentCount').textContent = inviteCustomers.filter(c => c.inviteSent).length;
            document.getElementById('inviteSubscribedCount').textContent = inviteCustomers.filter(c => c.subscribed).length;
        }
        
        // ===== 고객 목록 렌더링 =====
        function renderInviteCustomers() {
            const searchTerm = document.getElementById('inviteSearchInput') ? document.getElementById('inviteSearchInput').value.toLowerCase() : '';
            const filtered = inviteCustomers.filter(c => 
                c.name.toLowerCase().includes(searchTerm) ||
                c.phone.includes(searchTerm) ||
                (c.company && c.company.toLowerCase().includes(searchTerm))
            );
            
            const tbody = document.getElementById('inviteCustomerTableBody');
            
            if (!tbody) return;
            
            if (filtered.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="8" style="text-align: center; padding: 40px; opacity: 0.7;">
                            ${searchTerm ? '검색 결과가 없습니다.' : '아직 등록된 고객이 없습니다.<br>위에서 고객을 불러오세요.'}
                        </td>
                    </tr>
                `;
                return;
            }
            
            tbody.innerHTML = filtered.map(customer => {
                const isSelected = selectedInviteCustomers.has(customer.id);
                
                // ⭐ 호칭 미리보기
                const honorificType = customer.honorific || '님';
                let honorificPreview = '';
                switch(honorificType) {
                    case '님': honorificPreview = `${customer.name}님`; break;
                    case '직함님': honorificPreview = customer.position ? `${customer.position}님` : `${customer.name}님`; break;
                    case '고객님': honorificPreview = `${customer.name} 고객님`; break;
                    case '씨': honorificPreview = `${customer.name}씨`; break;
                    case '아야': 
                        const hasFinal = customer.name && (customer.name.charCodeAt(customer.name.length-1) - 0xAC00) % 28 !== 0;
                        honorificPreview = `${customer.name}${hasFinal ? '아' : '야'}`;
                        break;
                    case '이름만': honorificPreview = customer.name; break;
                    default: honorificPreview = `${customer.name}님`;
                }
                
                return `
                    <tr>
                        <td style="text-align: center;">
                            <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleInviteCustomerSelect(${customer.id})" style="cursor: pointer;">
                        </td>
                        <td>
                            <strong>${customer.name}</strong>
                            <div style="font-size: 11px; color: #FFD700; margin-top: 3px;">
                                💬 ${honorificPreview}
                            </div>
                        </td>
                        <td>${customer.phone}</td>
                        <td>${customer.company || '-'}</td>
                        <td>${customer.position || '-'}</td>
                        <td style="text-align: center;">
                            <span class="status-badge ${customer.subscribed ? 'status-subscribed' : customer.inviteSent ? 'status-sent' : 'status-pending'}">
                                ${customer.subscribed ? '✅ 구독완료' : customer.inviteSent ? '📤 발송됨' : '⏳ 대기'}
                            </span>
                        </td>
                        <td style="text-align: center; white-space: nowrap;">
                            <button class="btn-copy" onclick="copyInviteLink(${customer.id})" title="URL만 복사" style="background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%); color: white; padding: 6px 10px; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; margin: 2px;">
                                📋 URL
                            </button>
                            <button class="btn-copy" onclick="copyInviteMessage(${customer.id})" title="메시지+URL 복사" style="background: linear-gradient(135deg, #2196F3 0%, #1976D2 100%); color: white; padding: 6px 10px; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; margin: 2px;">
                                💬 메시지
                            </button>
                            <button class="btn-edit" onclick="editInviteCustomer(${customer.id})" title="수정" style="background: rgba(255, 193, 7, 0.8); padding: 6px 10px; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; margin: 2px;">✏️</button>
                            <button class="btn-delete" onclick="deleteInviteCustomer(${customer.id})" title="삭제" style="background: rgba(244, 67, 54, 0.8); color: white; padding: 6px 10px; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; margin: 2px;">🗑️</button>
                        </td>
                        </td>
                    </tr>
                `;
            }).join('');
            
            // 전체 선택 체크박스 상태 업데이트
            const selectAllCheckbox = document.getElementById('inviteSelectAll');
            if (selectAllCheckbox) {
                selectAllCheckbox.checked = inviteCustomers.length > 0 && selectedInviteCustomers.size === inviteCustomers.length;
            }
        }

        function handleCSVUpload(event) {
            const file = event.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const text = e.target.result;
                    parseCSV(text);
                } catch (error) {
                    console.error('CSV 파싱 오류:', error);
                    showAlert('❌ CSV 파일을 읽는 중 오류가 발생했습니다.', 'error');
                }
            };
            reader.onerror = function() {
                showAlert('❌ 파일을 읽을 수 없습니다.', 'error');
            };
            // UTF-8로 명시적으로 읽기
            reader.readAsText(file, 'UTF-8');
        }
        
        // ===== 공통 고객 추가 헬퍼 함수 =====
        function addCustomerToBothSystems(customerData) {
            const newCustomer = {
                id: customerData.id || Date.now(),
                name: customerData.name,
                phone: customerData.phone,
                company: customerData.company || '',
                position: customerData.position || '',
                email: customerData.email || '',
                honorific: customerData.honorific || '님',
                inviteSent: false,
                subscribed: false,
                createdAt: customerData.createdAt || new Date().toISOString()
            };
            
            // 초대 시스템에 추가
            inviteCustomers.push(newCustomer);
            
            // 고객 관리에도 추가
            customers.push({
                id: newCustomer.id,
                name: newCustomer.name,
                phone: newCustomer.phone,
                company: newCustomer.company,
                position: newCustomer.position,
                email: newCustomer.email,
                tags: [],
                birthday: '',
                memo: '',
                createdAt: newCustomer.createdAt
            });
            
            return newCustomer;
        }
        
        // ===== CSV/텍스트 파싱 =====
        // ===== CSV/텍스트 파싱 =====
        function parseCSV(text) {
            const lines = text.split('\n');
            let imported = 0;
            
            // 첫 줄이 헤더인지 확인
            const startIndex = lines[0].toLowerCase().includes('이름') || lines[0].toLowerCase().includes('name') ? 1 : 0;
            
            for (let i = startIndex; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                
                const parts = line.split(',').map(p => p.trim());
                if (parts.length >= 2) {
                    addCustomerToBothSystems({
                        id: Date.now() + imported,
                        name: parts[0],
                        phone: parts[1],
                        company: parts[2] || '',
                        position: parts[3] || '',
                        email: parts[4] || '',
                        honorific: '님'
                    });
                    imported++;
                }
            }
            
            saveInviteData();
            saveToDrive(FILES.customers, customers);
            renderCustomers();
            renderCustomersForSend();
            renderInviteCustomers();
            showAlert(`✅ ${imported}명의 고객을 가져왔습니다!`);
        }
        // ===== vCard 처리 =====
        function handleVCFUpload(event) {
            const files = event.target.files;
            let totalImported = 0;
            let processed = 0;
            
            Array.from(files).forEach(file => {
                const reader = new FileReader();
                reader.onload = function(e) {
                    try {
                        const vcf = e.target.result;
                        const imported = parseVCard(vcf);
                        totalImported += imported;
                        processed++;
                        
                        if (processed === files.length) {
                            saveInviteData();
                            saveToDrive(FILES.customers, customers);
                            renderCustomers();
                            renderCustomersForSend();
                            renderInviteCustomers();
                            
                            if (totalImported > 0) {
                                showAlert(`✅ ${totalImported}명의 연락처를 가져왔습니다!`);
                            } else {
                                showAlert('⚠️ 가져온 연락처가 없습니다. 파일 형식을 확인해주세요.', 'warning');
                            }
                        }
                    } catch (error) {
                        console.error('VCF 파싱 오류:', error);
                        showAlert('❌ 연락처 파일을 읽는 중 오류가 발생했습니다.', 'error');
                    }
                };
                reader.onerror = function() {
                    showAlert('❌ 파일을 읽을 수 없습니다.', 'error');
                };
                // UTF-8로 명시적으로 읽기
                reader.readAsText(file, 'UTF-8');
            });
        }
        
        // ===== QUOTED-PRINTABLE 디코딩 함수 =====
        function decodeQuotedPrintable(str) {
            if (!str) return '';
            
            // =XX 형태의 16진수를 바이트로 변환
            const bytes = [];
            let i = 0;
            
            while (i < str.length) {
                if (str[i] === '=' && i + 2 < str.length) {
                    const hex = str.substring(i + 1, i + 3);
                    bytes.push(parseInt(hex, 16));
                    i += 3;
                } else {
                    bytes.push(str.charCodeAt(i));
                    i++;
                }
            }
            
            // UTF-8 디코딩
            try {
                return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
            } catch (e) {
                console.error('디코딩 오류:', e);
                return str;
            }
        }
        
        // ===== vCard 파싱 개선 =====
        function parseVCard(vcfText) {
            const vcards = vcfText.split('BEGIN:VCARD');
            let imported = 0;
            
            vcards.slice(1).forEach(vcard => {
                const contact = {};
                
                // 줄 접기(line folding) 처리: 다음 줄이 공백으로 시작하면 이전 줄과 합침
                const lines = vcard.split(/\r?\n/).reduce((acc, line) => {
                    if (line.startsWith(' ') || line.startsWith('\t')) {
                        if (acc.length > 0) {
                            acc[acc.length - 1] += line.trim();
                        }
                    } else {
                        acc.push(line);
                    }
                    return acc;
                }, []);
                
                lines.forEach(line => {
                    line = line.trim();
                    
                    // FN (Full Name) - 이름
                    if (line.startsWith('FN')) {
                        const value = line.split(':')[1];
                        if (value) {
                            // ENCODING=QUOTED-PRINTABLE 체크
                            if (line.includes('ENCODING=QUOTED-PRINTABLE') || line.includes('ENCODING=quoted-printable')) {
                                contact.name = decodeQuotedPrintable(value.trim());
                            } else {
                                contact.name = value.trim();
                            }
                        }
                    }
                    
                    // N (Name) - FN이 없을 경우 대체
                    else if (line.startsWith('N:') && !contact.name) {
                        const parts = line.substring(2).split(';');
                        const lastName = parts[0] || '';
                        const firstName = parts[1] || '';
                        contact.name = (lastName + firstName).trim();
                    }
                    
                    // TEL (Telephone) - 전화번호
                    else if (line.startsWith('TEL')) {
                        const value = line.split(':')[1];
                        if (value) {
                            let phone = value.trim();
                            // ENCODING=QUOTED-PRINTABLE 체크
                            if (line.includes('ENCODING=QUOTED-PRINTABLE') || line.includes('ENCODING=quoted-printable')) {
                                phone = decodeQuotedPrintable(phone);
                            }
                            // 숫자와 하이픈만 남기기
                            phone = phone.replace(/[^0-9-]/g, '');
                            if (phone && !contact.phone) {
                                contact.phone = phone;
                            }
                        }
                    }
                    
                    // EMAIL - 이메일
                    else if (line.startsWith('EMAIL')) {
                        const value = line.split(':')[1];
                        if (value) {
                            let email = value.trim();
                            // ENCODING=QUOTED-PRINTABLE 체크
                            if (line.includes('ENCODING=QUOTED-PRINTABLE') || line.includes('ENCODING=quoted-printable')) {
                                email = decodeQuotedPrintable(email);
                            }
                            if (email && !contact.email) {
                                contact.email = email;
                            }
                        }
                    }
                    
                    // ORG (Organization) - 회사명
                    else if (line.startsWith('ORG')) {
                        const value = line.split(':')[1];
                        if (value) {
                            let org = value.trim();
                            // ENCODING=QUOTED-PRINTABLE 체크
                            if (line.includes('ENCODING=QUOTED-PRINTABLE') || line.includes('ENCODING=quoted-printable')) {
                                org = decodeQuotedPrintable(org);
                            }
                            const parts = org.split(';');
                            contact.company = parts[0]?.trim();
                        }
                    }
                    
                    // TITLE - 직함
                    else if (line.startsWith('TITLE')) {
                        const value = line.split(':')[1];
                        if (value) {
                            let title = value.trim();
                            // ENCODING=QUOTED-PRINTABLE 체크
                            if (line.includes('ENCODING=QUOTED-PRINTABLE') || line.includes('ENCODING=quoted-printable')) {
                                title = decodeQuotedPrintable(title);
                            }
                            contact.position = title;
                        }
                    }
                });
                
                // 이름과 전화번호가 있을 때만 추가
                if (contact.name && contact.phone) {
                    addCustomerToBothSystems({
                        id: Date.now() + imported,
                        name: contact.name,
                        phone: contact.phone,
                        company: contact.company || '',
                        position: contact.position || '',
                        email: contact.email || '',
                        honorific: '님'
                    });
                    imported++;
                }
            });
            
            return imported;
        }
        
        // ===== 휴대폰 연락처 직접 선택 (Contact Picker API) =====
        async function pickContacts() {
            // Contact Picker API 지원 여부 확인
            if (!('contacts' in navigator && 'ContactsManager' in window)) {
                showAlert(`❌ Contact Picker API를 지원하지 않는 브라우저입니다.

📱 Android Chrome 사용 권장!

💡 대신 이렇게 하세요:
1️⃣ 폰 연락처 앱 열기
2️⃣ 메뉴 → "연락처 내보내기" 또는 "공유"
3️⃣ vCard 파일(.vcf)로 저장
4️⃣ 여기서 "📇 폰연락처" 버튼 클릭
5️⃣ 저장한 .vcf 파일 선택 (다중 선택 가능)`, 'error');
                return;
            }
            
            try {
                // 가져올 정보 속성 지정
                const props = ['name', 'tel', 'email'];
                const opts = { multiple: true }; // 여러 명 선택 가능
                
                // 사용자에게 연락처 선택 UI 표시
                const contacts = await navigator.contacts.select(props, opts);
                
                if (!contacts || contacts.length === 0) {
                    showAlert('ℹ️ 선택된 연락처가 없습니다.', 'info');
                    return;
                }
                
                let imported = 0;
                
                // 선택된 연락처들을 양쪽 시스템에 추가
                contacts.forEach(contact => {
                    const name = contact.name && contact.name.length > 0 ? contact.name[0] : '';
                    const tel = contact.tel && contact.tel.length > 0 ? contact.tel[0] : '';
                    const email = contact.email && contact.email.length > 0 ? contact.email[0] : '';
                    
                    if (name && tel) {
                        // 중복 체크 (전화번호 기준)
                        const exists = inviteCustomers.some(c => c.phone === tel);
                        if (!exists) {
                            addCustomerToBothSystems({
                                id: Date.now() + imported,
                                name: name,
                                phone: tel,
                                company: '',
                                position: '',
                                email: email,
                                honorific: '님'
                            });
                            imported++;
                        }
                    }
                });
                
                if (imported > 0) {
                    saveInviteData();
                    saveToDrive(FILES.customers, customers);
                    renderCustomers();
                    renderCustomersForSend();
                    renderInviteCustomers();
                    updateInviteStats();
                    showAlert(`✅ ${imported}명의 연락처를 가져왔습니다!`, 'success');
                } else {
                    showAlert('ℹ️ 새로 추가된 연락처가 없습니다. (중복 제외)', 'info');
                }
                
            } catch (error) {
                console.error('연락처 선택 오류:', error);
                if (error.name === 'NotSupportedError') {
                    showAlert('❌ 이 브라우저는 연락처 직접 선택을 지원하지 않습니다.\n\n💡 파일 업로드 방식을 이용해주세요.', 'error');
                } else if (error.name === 'SecurityError') {
                    showAlert('❌ 보안 정책으로 인해 연락처 접근이 거부되었습니다.\n\n💡 HTTPS 환경에서만 사용 가능합니다.', 'error');
                } else {
                    showAlert('❌ 연락처를 가져오는 중 오류가 발생했습니다.', 'error');
                }
            }
        }
        
        // ===== 텍스트 입력 =====
        function openTextImport() {
            openModal('textModal');
        }
        
        function importFromText() {
            const text = document.getElementById('textInput').value.trim();
            if (!text) {
                showAlert('❌ 텍스트를 입력해주세요.', true);
                return;
            }
            
            parseCSV(text);
            document.getElementById('textInput').value = '';
            closeModal('textModal');
        }
        
        // ===== 직접 추가 =====
        function openManualAdd() {
            openModal('manualModal');
        }
        
        function addManualCustomer() {
            const name = document.getElementById('manualName').value.trim();
            const phone = document.getElementById('manualPhone').value.trim();
            
            if (!name || !phone) {
                showAlert('❌ 이름과 전화번호는 필수입니다.', true);
                return;
            }
            
            const newCustomer = {
                id: Date.now(),
                name: name,
                phone: phone,
                company: document.getElementById('manualCompany').value.trim(),
                position: document.getElementById('manualPosition').value.trim(),
                email: document.getElementById('manualEmail').value.trim(),
                honorific: '님', // ⭐ 기본 호칭
                inviteSent: false,
                subscribed: false,
                createdAt: new Date().toISOString()
            };
            
            // 초대 시스템에 추가
            inviteCustomers.push(newCustomer);
            
            // 고객 관리에도 추가 (중요!)
            customers.push({
                id: newCustomer.id,
                name: newCustomer.name,
                phone: newCustomer.phone,
                company: newCustomer.company,
                position: newCustomer.position,
                email: newCustomer.email,
                tags: [],
                birthday: '',
                memo: '',
                createdAt: newCustomer.createdAt
            });
            
            // 저장 및 렌더링
            saveInviteData();
            saveToDrive(FILES.customers, customers);
            closeModal('manualModal');
            showAlert(`✅ ${name}님이 추가되었습니다!`);
            
            // 렌더링 업데이트
            renderCustomers();
            renderCustomersForSend();
            renderInviteCustomers();
            
            // 입력 필드 초기화
            document.getElementById('manualName').value = '';
            document.getElementById('manualPhone').value = '';
            document.getElementById('manualCompany').value = '';
            document.getElementById('manualPosition').value = '';
            document.getElementById('manualEmail').value = '';
        }
        
        // ===== 초대 링크 생성 =====
        function generateInviteLink(customerId) {
            // 자동 도메인 감지 (Netlify 배포된 주소 자동 사용)
            const baseUrl = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
            
            // 고객 정보 찾기
            const customer = inviteCustomers.find(c => c.id === customerId) || customers.find(c => c.id === customerId);
            
            if (!customer) return baseUrl + 'subscribe.html';
            
            // 컨설턴트 정보 가져오기
            const consultantName = localStorage.getItem('kfpc_consultant_name') || '담당자';
            const consultantCompany = localStorage.getItem('kfpc_consultant_company') || 'KFPC';
            const consultantTitle = localStorage.getItem('kfpc_consultant_position') || '';
            
            // 데이터를 JSON으로 압축
            const data = {
                n: customer.name,           // 고객명
                i: customerId,              // 고객 ID
                c: consultantName,          // 컨설턴트 이름
                co: consultantCompany,      // 회사명
                t: consultantTitle          // 직함
            };
            
            // Base64 인코딩으로 압축
            const encoded = btoa(encodeURIComponent(JSON.stringify(data)));
            
            // 최종 단축 URL: https://push-kfpc.netlify.app/subscribe.html?d=encoded_data
            return `${baseUrl}subscribe.html?d=${encoded}`;
        }
        
        // ===== 초대 메시지 생성 =====
        function generateInviteMessage(customer) {
            const inviteLink = generateInviteLink(customer.id);
            
            return messageTemplate
                .replace(/{이름}/g, customer.name)
                .replace(/{컨설턴트}/g, consultantName)
                .replace(/{초대링크}/g, inviteLink);
        }
        
        // ===== 공통 구독 URL 생성 (SNS/강의용) =====
        function generateCommonUrl() {
            const baseUrl = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
            const consultantName = localStorage.getItem('kfpc_consultant_name') || '';
            
            if (consultantName) {
                // 컨설턴트 이름이 있으면 포함
                return `${baseUrl}subscribe.html?c=${encodeURIComponent(consultantName)}`;
            } else {
                // 컨설턴트 이름이 없으면 기본 URL
                return `${baseUrl}subscribe.html`;
            }
        }
        
        // ===== 공통 URL 복사 =====
        function copyCommonUrl() {
            const url = generateCommonUrl();
            
            navigator.clipboard.writeText(url).then(() => {
                showAlert(`✅ 공통 구독 URL이 복사되었습니다!\n\nSNS/강의/단체문자 등에 활용하세요.`);
            }).catch(() => {
                showAlert('❌ 복사에 실패했습니다.', 'error');
            });
        }
        
        // ===== 공통 URL 메시지 복사 =====
        function copyCommonMessage() {
            const url = generateCommonUrl();
            const consultantName = localStorage.getItem('kfpc_consultant_name') || '담당자';
            
            const message = `안녕하세요! 👋

KFPC ${consultantName}입니다.

실시간 재무 정보와 세무 뉴스를 받아보세요!

👉 구독하기: ${url}

언제든지 문의 주세요! 😊`;
            
            navigator.clipboard.writeText(message).then(() => {
                showAlert(`✅ 공통 구독 메시지가 복사되었습니다!\n\nSNS/강의/단체문자 등에 활용하세요.`);
            }).catch(() => {
                showAlert('❌ 복사에 실패했습니다.', 'error');
            });
        }
        
        // ===== 초대 링크 복사 =====
        function copyInviteLink(customerId) {
            const customer = inviteCustomers.find(c => c.id === customerId) || customers.find(c => c.id === customerId);
            if (!customer) return;
            
            const inviteLink = generateInviteLink(customerId);
            
            navigator.clipboard.writeText(inviteLink).then(() => {
                showAlert(`✅ ${customer.name}님의 초대 링크가 복사되었습니다!`);
            }).catch(() => {
                showAlert('❌ 복사에 실패했습니다.', 'error');
            });
        }
        
        // ===== 메시지+URL 복사 =====
        function copyInviteMessage(customerId) {
            const customer = inviteCustomers.find(c => c.id === customerId);
            if (!customer) return;
            
            const inviteLink = generateInviteLink(customerId);
            const consultantName = localStorage.getItem('kfpc_consultant_name') || '담당자';
            
            // 메시지 템플릿 (사용자가 수정 가능)
            const message = `안녕하세요, ${customer.name}님! 👋

KFPC ${consultantName}입니다.

실시간 재무 정보와 세무 뉴스를 받아보세요!

👉 구독하기: ${inviteLink}

언제든지 문의 주세요! 😊`;
            
            navigator.clipboard.writeText(message).then(() => {
                showAlert(`✅ ${customer.name}님에게 보낼 메시지가 복사되었습니다!\n\n문자/메신저로 발송하세요.`);
            }).catch(() => {
                showAlert('❌ 복사에 실패했습니다.', 'error');
            });
        }
        
        // ===== 고객 삭제 =====
        function deleteInviteCustomer(customerId) {
            const customer = inviteCustomers.find(c => c.id === customerId);
            if (!customer) return;
            
            if (confirm(`${customer.name}님을 삭제하시겠습니까?`)) {
                inviteCustomers = inviteCustomers.filter(c => c.id !== customerId);
                saveInviteData();
                showAlert(`✅ ${customer.name}님이 삭제되었습니다.`);
            }
        }
        
        // ===== 메시지 템플릿 저장 =====
        function saveMessageTemplate() {
            consultantName = document.getElementById('consultantName').value.trim();
            messageTemplate = document.getElementById('messageTemplate').value.trim();
            
            if (!consultantName || !messageTemplate) {
                showAlert('❌ 이름과 메시지를 입력해주세요.', true);
                return;
            }
            
            saveInviteData();
            showAlert('✅ 템플릿이 저장되었습니다!');
        }
        
        // ===== 컨설턴트 정보 관리 =====
        function saveConsultantInfo() {
            const company = document.getElementById('consultantCompany').value.trim();
            const name = document.getElementById('consultantNameSet').value.trim();
            const position = document.getElementById('consultantPosition').value.trim();
            
            if (!name) {
                showAlert('❌ 컨설턴트 성명은 필수입니다.', true);
                return;
            }
            
            // 저장
            localStorage.setItem('kfpc_consultant_company', company);
            localStorage.setItem('kfpc_consultant_name', name);
            localStorage.setItem('kfpc_consultant_position', position);
            
            // 가져오기 탭의 consultantName 필드도 동기화
            const consultantNameField = document.getElementById('consultantName');
            if (consultantNameField) {
                consultantNameField.value = name;
            }
            
            showAlert('✅ 컨설턴트 정보가 저장되었습니다!');
            updateConsultantPreview();
        }
        
        function loadConsultantInfo() {
            const company = localStorage.getItem('kfpc_consultant_company') || '';
            const name = localStorage.getItem('kfpc_consultant_name') || '';
            const position = localStorage.getItem('kfpc_consultant_position') || '';
            
            document.getElementById('consultantCompany').value = company;
            document.getElementById('consultantNameSet').value = name;
            document.getElementById('consultantPosition').value = position;
            
            updateConsultantPreview();
            
            // 입력 필드에 이벤트 리스너 추가
            ['consultantCompany', 'consultantNameSet', 'consultantPosition'].forEach(id => {
                document.getElementById(id).addEventListener('input', updateConsultantPreview);
            });
        }
        
        function updateConsultantPreview() {
            const company = document.getElementById('consultantCompany').value.trim();
            const name = document.getElementById('consultantNameSet').value.trim() || '컨설턴트';
            const position = document.getElementById('consultantPosition').value.trim();
            
            let preview = '- ';
            if (company) preview += company + ' ';
            if (position) preview += position + ' ';
            preview += name + ' 드림';
            
            document.getElementById('previewText').textContent = preview;
        }
        
        function getConsultantSignature() {
            const company = localStorage.getItem('kfpc_consultant_company') || '';
            const name = localStorage.getItem('kfpc_consultant_name') || '컨설턴트';
            const position = localStorage.getItem('kfpc_consultant_position') || '';
            
            let signature = '';
            if (company) signature += company + ' ';
            if (position) signature += position + ' ';
            signature += name;
            
            return signature;
        }
        
        
        // ===== 고객 목록 백업 =====
        function exportInviteCustomers() {
            if (inviteCustomers.length === 0) {
                showAlert('❌ 백업할 고객이 없습니다.', true);
                return;
            }
            
            const csv = [
                ['이름', '전화번호', '회사', '직함', '이메일', '초대발송', '구독상태', '등록일'].join(','),
                ...inviteCustomers.map(c => [
                    c.name,
                    c.phone,
                    c.company,
                    c.position,
                    c.email,
                    c.inviteSent ? '발송됨' : '미발송',
                    c.subscribed ? '구독완료' : '미구독',
                    new Date(c.createdAt).toLocaleString('ko-KR')
                ].join(','))
            ].join('\n');
            
            const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `kfpc_customers_${new Date().toISOString().slice(0,10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            
            showAlert('✅ 고객 목록이 다운로드되었습니다!');
        }
        
        // ===== vCard 내보내기 (휴대폰 연락처 저장용) =====
        function exportToVCard() {
            if (customers.length === 0 && inviteCustomers.length === 0) {
                showAlert('❌ 내보낼 고객이 없습니다.', 'error');
                return;
            }
            
            // 모든 고객 합치기
            const allCustomers = [...customers, ...inviteCustomers];
            
            if (allCustomers.length === 0) {
                showAlert('❌ 내보낼 고객이 없습니다.', 'error');
                return;
            }
            
            // vCard 형식으로 변환
            let vcfContent = '';
            
            allCustomers.forEach(customer => {
                if (!customer.name || !customer.phone) return;
                
                vcfContent += 'BEGIN:VCARD\r\n';
                vcfContent += 'VERSION:3.0\r\n';
                vcfContent += `FN:${customer.name}\r\n`;
                vcfContent += `N:${customer.name};;;;\r\n`;
                
                // 전화번호
                const phone = customer.phone.replace(/[^0-9]/g, '');
                vcfContent += `TEL;TYPE=CELL:${phone}\r\n`;
                
                // 이메일
                if (customer.email) {
                    vcfContent += `EMAIL;TYPE=INTERNET:${customer.email}\r\n`;
                }
                
                // 회사
                if (customer.company) {
                    vcfContent += `ORG:${customer.company}\r\n`;
                }
                
                // 직함
                if (customer.position) {
                    vcfContent += `TITLE:${customer.position}\r\n`;
                }
                
                // 메모 (KFPC 고객임을 표시)
                vcfContent += 'NOTE:KFPC 고객\r\n';
                
                vcfContent += 'END:VCARD\r\n';
            });
            
            // 파일 다운로드
            const blob = new Blob([vcfContent], { type: 'text/vcard;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `KFPC_고객연락처_${new Date().toISOString().slice(0,10)}.vcf`;
            a.click();
            URL.revokeObjectURL(url);
            
            showAlert(`✅ ${allCustomers.length}명의 연락처가 vCard 형식으로 다운로드되었습니다!\n\n📱 휴대폰에서 파일을 열면 연락처 앱에 자동으로 추가됩니다.`, 'success');
        }
        
        // ===== 선택 삭제 =====
        function deleteSelectedInviteCustomers() {
            const selectedIds = selectedInviteCustomers;
            
            if (selectedIds.length === 0) {
                showAlert('ℹ️ 삭제할 고객을 선택해주세요.', 'info');
                return;
            }
            
            const selectedNames = inviteCustomers
                .filter(c => selectedIds.includes(c.id))
                .map(c => c.name)
                .join(', ');
            
            if (!confirm(`⚠️ 선택한 ${selectedIds.length}명의 고객을 삭제하시겠습니까?\n\n${selectedNames}\n\n이 작업은 되돌릴 수 없습니다.`)) {
                return;
            }
            
            // 선택된 고객들 삭제
            inviteCustomers = inviteCustomers.filter(c => !selectedIds.includes(c.id));
            
            // 선택 목록 초기화
            selectedInviteCustomers = [];
            
            // 저장 및 화면 갱신
            saveInviteData();
            
            showAlert(`✅ ${selectedIds.length}명의 고객이 삭제되었습니다.`, 'success');
        }
        
        // ===== 전체 삭제 (일괄 삭제) =====
        function clearAllInviteCustomers() {
            if (!confirm('⚠️ 모든 고객 정보를 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.')) {
                return;
            }
            
            if (!confirm('정말로 삭제하시겠습니까?')) {
                return;
            }
            
            inviteCustomers = [];
            saveInviteData();
            showAlert('✅ 모든 고객 정보가 삭제되었습니다.');
        }
        
        // ===== 모달 =====
        function openModal(id) {
            document.getElementById(id).classList.add('active');
        }
        
        function closeModal(id) {
            document.getElementById(id).classList.remove('active');
        }
        
        // ===== 알림 =====
        function showAlert(message, isError = false) {
            const alert = document.createElement('div');
            alert.className = `alert ${isError ? 'error' : ''}`;
            alert.textContent = message;
            document.body.appendChild(alert);
            
            setTimeout(() => {
                alert.remove();
            }, 3000);
        }
        
        // ===== 초기화 =====
        window.addEventListener('load', () => { init(); if (typeof initInvite === 'function') initInvite(); });
        
        // ===============================================================
        
        
        // ===== 고객 정보 수정 =====
        function editInviteCustomer(customerId) {
            const customer = inviteCustomers.find(c => c.id === customerId);
            if (!customer) return;
            
            // 그룹 옵션 업데이트
            const groupSelect = document.getElementById('editGroup');
            if (groupSelect) {
                groupSelect.innerHTML = '<option value="">그룹 없음</option>' + 
                    customerGroups.map(g => `<option value="${g}">${g}</option>`).join('') +
                    '<option value="__custom__">➕ 직접 입력</option>';
            }
            
            // 수정 모달에 기존 데이터 채우기
            document.getElementById('editCustomerId').value = customer.id;
            document.getElementById('editName').value = customer.name;
            document.getElementById('editPhone').value = customer.phone;
            document.getElementById('editCompany').value = customer.company || '';
            document.getElementById('editPosition').value = customer.position || '';
            document.getElementById('editEmail').value = customer.email || '';
            document.getElementById('editHonorific').value = customer.honorific || '님'; // ⭐ 호칭 불러오기
            
            // 그룹 불러오기
            if (groupSelect && customer.group) {
                groupSelect.value = customer.group;
            }
            
            openModal('editCustomerModal');
        }
        
        function saveEditedCustomer() {
            const customerId = parseInt(document.getElementById('editCustomerId').value);
            const customer = inviteCustomers.find(c => c.id === customerId);
            
            if (!customer) return;
            
            const name = document.getElementById('editName').value.trim();
            const phone = document.getElementById('editPhone').value.trim();
            
            if (!name || !phone) {
                showInviteAlert('이름과 전화번호는 필수입니다.', true);
                return;
            }
            
            // 고객 정보 업데이트
            customer.name = name;
            customer.phone = phone;
            customer.company = document.getElementById('editCompany').value.trim();
            customer.position = document.getElementById('editPosition').value.trim();
            customer.email = document.getElementById('editEmail').value.trim();
            customer.honorific = document.getElementById('editHonorific').value; // ⭐ 호칭 추가
            
            // 그룹 저장
            const group = document.getElementById('editGroup')?.value || '';
            if (group) {
                customer.group = group;
            } else {
                delete customer.group;
            }
            
            customer.updatedAt = new Date().toISOString();
            
            saveInviteData();
            closeModal('editCustomerModal');
            showInviteAlert(`✅ ${name}님의 정보가 수정되었습니다!`);
        }
        
        // ===== 고객 선택 관리 =====
        let selectedInviteCustomers = new Set();
        
        function toggleInviteCustomerSelect(customerId) {
            if (selectedInviteCustomers.has(customerId)) {
                selectedInviteCustomers.delete(customerId);
            } else {
                selectedInviteCustomers.add(customerId);
            }
            updateInviteSelectionInfo();
        }
        
        function toggleInviteSelectAll() {
            const checkbox = document.getElementById('inviteSelectAll');
            
            if (checkbox.checked) {
                inviteCustomers.forEach(c => selectedInviteCustomers.add(c.id));
            } else {
                selectedInviteCustomers.clear();
            }
            
            renderInviteCustomers();
            updateInviteSelectionInfo();
        }
        
        function updateInviteSelectionInfo() {
            const info = document.getElementById('inviteSelectionInfo');
            if (info) {
                info.textContent = `${selectedInviteCustomers.size}명 선택됨`;
            }
        }
        
        // ===== 휴대폰으로 전송 =====
        // ===== 선택한 고객들의 URL 복사 =====
        function copySelectedURLs() {
            if (selectedInviteCustomers.size === 0) {
                showAlert('❌ 복사할 고객을 선택해주세요.', 'error');
                return;
            }
            
            const selected = inviteCustomers.filter(c => selectedInviteCustomers.has(c.id));
            
            // URL 목록 생성
            let urlList = '📋 구독 URL 목록\n';
            urlList += '━━━━━━━━━━━━━━━\n\n';
            
            selected.forEach((customer, index) => {
                const url = generateInviteLink(customer.id);
                urlList += `${index + 1}. ${customer.name}\n`;
                urlList += `${url}\n\n`;
            });
            
            urlList += `━━━━━━━━━━━━━━━\n`;
            urlList += `총 ${selected.length}명`;
            
            navigator.clipboard.writeText(urlList).then(() => {
                showAlert(`✅ ${selected.length}명의 URL이 복사되었습니다!\n\n문자/메신저로 각 고객에게 발송하세요.`);
            }).catch(() => {
                showAlert('❌ 복사에 실패했습니다.', 'error');
            });
        }
        
        // ===== 선택한 고객들의 메시지 복사 =====
        function copySelectedMessages() {
            if (selectedInviteCustomers.size === 0) {
                showAlert('❌ 복사할 고객을 선택해주세요.', 'error');
                return;
            }
            
            const selected = inviteCustomers.filter(c => selectedInviteCustomers.has(c.id));
            const consultantName = localStorage.getItem('kfpc_consultant_name') || '담당자';
            
            // 각 고객별 메시지 생성
            let messages = '';
            
            selected.forEach((customer, index) => {
                const url = generateInviteLink(customer.id);
                
                messages += `━━━━━━━━━━━━━━━\n`;
                messages += `${index + 1}. ${customer.name}님에게 보낼 메시지:\n`;
                messages += `━━━━━━━━━━━━━━━\n\n`;
                messages += `안녕하세요, ${customer.name}님! 👋\n\n`;
                messages += `KFPC ${consultantName}입니다.\n\n`;
                messages += `실시간 재무 정보와 세무 뉴스를 받아보세요!\n\n`;
                messages += `👉 구독하기: ${url}\n\n`;
                messages += `언제든지 문의 주세요! 😊\n\n\n`;
            });
            
            messages += `━━━━━━━━━━━━━━━\n`;
            messages += `총 ${selected.length}명\n`;
            messages += `━━━━━━━━━━━━━━━`;
            
            navigator.clipboard.writeText(messages).then(() => {
                showAlert(`✅ ${selected.length}명에게 보낼 메시지가 복사되었습니다!\n\n각 고객에게 맞는 메시지를 복사해서 발송하세요.`);
            }).catch(() => {
                showAlert('❌ 복사에 실패했습니다.', 'error');
            });
        }
        
        function sendSelectedToPhone() {
            if (selectedInviteCustomers.size === 0) {
                showInviteAlert('❌ 전송할 고객을 선택해주세요.', true);
                return;
            }
            
            const selected = inviteCustomers.filter(c => selectedInviteCustomers.has(c.id));
            
            // vCard 형식으로 변환
            let vCardData = '';
            
            selected.forEach(customer => {
                vCardData += `BEGIN:VCARD\nVERSION:3.0\n`;
                vCardData += `FN:${customer.name}\n`;
                vCardData += `TEL:${customer.phone}\n`;
                if (customer.email) vCardData += `EMAIL:${customer.email}\n`;
                if (customer.company) vCardData += `ORG:${customer.company}\n`;
                if (customer.position) vCardData += `TITLE:${customer.position}\n`;
                vCardData += `END:VCARD\n\n`;
            });
            
            // Blob 생성 및 다운로드
            const blob = new Blob([vCardData], { type: 'text/vcard;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `selected_customers_${new Date().toISOString().slice(0,10)}.vcf`;
            a.click();
            URL.revokeObjectURL(url);
            
            showInviteAlert(`✅ ${selected.length}명의 연락처가 다운로드되었습니다!`);
        }
        
        function sendAllToPhone() {
            if (inviteCustomers.length === 0) {
                showInviteAlert('❌ 전송할 고객이 없습니다.', true);
                return;
            }
            
            // vCard 형식으로 변환
            let vCardData = '';
            
            inviteCustomers.forEach(customer => {
                vCardData += `BEGIN:VCARD\nVERSION:3.0\n`;
                vCardData += `FN:${customer.name}\n`;
                vCardData += `TEL:${customer.phone}\n`;
                if (customer.email) vCardData += `EMAIL:${customer.email}\n`;
                if (customer.company) vCardData += `ORG:${customer.company}\n`;
                if (customer.position) vCardData += `TITLE:${customer.position}\n`;
                vCardData += `END:VCARD\n\n`;
            });
            
            // Blob 생성 및 다운로드
            const blob = new Blob([vCardData], { type: 'text/vcard;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `all_customers_${new Date().toISOString().slice(0,10)}.vcf`;
            a.click();
            URL.revokeObjectURL(url);
            
            showInviteAlert(`✅ 전체 ${inviteCustomers.length}명의 연락처가 다운로드되었습니다!`);
        }
        
        // showAlert를 showInviteAlert로 래핑 (중복 방지)
        function showInviteAlert(message, isError = false) {
            if (typeof showAlert === 'function') {
                showAlert(message, isError ? 'error' : 'success');
            } else {
                alert(message);
            }
        }
// 고객 초대 시스템 함수들 끝
        // ===============================================================
        
        // ================================================================
        // 예약 메시지 사전 확인 시스템 (NEW)
        // ================================================================
        
        // 예약 메시지 데이터 로드
        function loadScheduledMessages() {
            const saved = localStorage.getItem('scheduledMessages');
            if (saved) {
                scheduledMessages = JSON.parse(saved);
            }
            updatePendingBadge();
        }
        
        // 예약 메시지 데이터 저장
        function saveScheduledMessages() {
            localStorage.setItem('scheduledMessages', JSON.stringify(scheduledMessages));
            updatePendingBadge();
        }
        
        // 승인 대기 배지 업데이트
        function updatePendingBadge() {
            const pendingCount = scheduledMessages.filter(m => m.status === 'pending-approval').length;
            const badge = document.getElementById('pendingBadge');
            if (badge) {
                if (pendingCount > 0) {
                    badge.textContent = pendingCount;
                    badge.style.display = 'inline-block';
                } else {
                    badge.style.display = 'none';
                }
            }
        }
        
        // 예약 메시지 생성 (메시지 발송 폼에서 예약 발송 선택 시)
        function createScheduledMessage(title, body, customerIds, scheduledTime) {
            const message = {
                id: Date.now(),
                title: title,
                body: body,
                customerIds: customerIds,
                customerCount: customerIds.length,
                scheduledTime: scheduledTime,
                status: 'draft', // draft, pending-approval, approved, sent, cancelled
                createdAt: new Date().toISOString(),
                approvedAt: null,
                sentAt: null,
                approvedBy: null,
                modifiedAt: null
            };
            
            scheduledMessages.push(message);
            saveScheduledMessages();
            
            // 발송 전일 오전 10시에 알림을 보내야 하는지 확인
            checkAndSetApprovalAlert(message);
            
            return message;
        }
        
        // 발송 전일 오전 10시 확인 (시뮬레이션)
        function checkAndSetApprovalAlert(message) {
            const scheduledDate = new Date(message.scheduledTime);
            const dayBefore = new Date(scheduledDate);
            dayBefore.setDate(dayBefore.getDate() - 1);
            dayBefore.setHours(10, 0, 0, 0);
            
            const now = new Date();
            
            // 발송 시간이 24시간 이상 남았으면 사전 확인 대기 상태로
            if (scheduledDate - now > 24 * 60 * 60 * 1000) {
                message.status = 'pending-approval';
                message.approvalAlertTime = dayBefore.toISOString();
            } else {
                // 24시간 미만이면 즉시 확인 필요
                message.status = 'pending-approval';
                message.approvalAlertTime = new Date().toISOString();
            }
        }
        
        // 예약 메시지 목록 렌더링
        function renderScheduledMessages() {
            const container = document.getElementById('scheduledMessagesList');
            const filter = document.getElementById('scheduledFilter')?.value || 'all';
            
            if (!container) return;
            
            let filtered = scheduledMessages;
            if (filter !== 'all') {
                filtered = scheduledMessages.filter(m => m.status === filter);
            }
            
            // 최신순 정렬
            filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            
            if (filtered.length === 0) {
                container.innerHTML = `
                    <div class="empty-state" style="text-align: center; padding: 60px 20px; opacity: 0.7;">
                        <div style="font-size: 48px; margin-bottom: 15px;">📭</div>
                        <div style="font-size: 16px;">예약된 메시지가 없습니다</div>
                    </div>
                `;
                return;
            }
            
            container.innerHTML = `
                <table class="customers-table">
                    <thead>
                        <tr>
                            <th>No</th>
                            <th>제목</th>
                            <th>내용 미리보기</th>
                            <th>수신자</th>
                            <th>발송 예정</th>
                            <th>상태</th>
                            <th>작업</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filtered.map((msg, index) => {
                            const scheduledDate = new Date(msg.scheduledTime);
                            const isPending = msg.status === 'pending-approval';
                            const isApproved = msg.status === 'approved';
                            
                            let statusText = '💾 임시 저장';
                            let statusClass = 'draft';
                            let statusColor = '#999';
                            
                            if (isPending) {
                                statusText = '🔔 승인 대기';
                                statusClass = 'pending-approval';
                                statusColor = '#FF9800';
                            } else if (isApproved) {
                                statusText = '✅ 승인 완료';
                                statusClass = 'approved';
                                statusColor = '#4CAF50';
                            } else if (msg.status === 'sent') {
                                statusText = '📤 발송 완료';
                                statusClass = 'sent';
                                statusColor = '#2196F3';
                            } else if (msg.status === 'cancelled') {
                                statusText = '❌ 취소됨';
                                statusClass = 'cancelled';
                                statusColor = '#F44336';
                            }
                            
                            return `
                                <tr>
                                    <td>${filtered.length - index}</td>
                                    <td><strong>${msg.title}</strong></td>
                                    <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${msg.body}</td>
                                    <td>${msg.customerCount || 0}명</td>
                                    <td style="white-space: nowrap;">${formatDateTime(scheduledDate)}</td>
                                    <td>
                                        <span style="padding: 4px 8px; background: ${statusColor}22; color: ${statusColor}; border-radius: 4px; font-size: 11px; white-space: nowrap; font-weight: bold;">
                                            ${statusText}
                                        </span>
                                    </td>
                                    <td style="white-space: nowrap;">
                                        ${isPending ? `
                                            <button class="table-action-btn" onclick="approveMessage(${msg.id})" title="승인" style="background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);">승인</button>
                                            <button class="table-action-btn" onclick="modifyMessage(${msg.id})" title="수정" style="background: linear-gradient(135deg, #2196F3 0%, #1976D2 100%);">수정</button>
                                        ` : ''}
                                        ${(isPending || isApproved) ? `
                                            <button class="table-action-btn" onclick="cancelMessage(${msg.id})" title="취소" style="background: linear-gradient(135deg, #FF6B6B 0%, #EE5A52 100%);">취소</button>
                                        ` : ''}
                                        ${msg.status === 'sent' ? `
                                            <button class="table-action-btn" onclick="viewMessageDetail(${msg.id})" title="결과">결과</button>
                                        ` : ''}
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            `;
        }
        
        // 메시지 승인
        function approveMessage(messageId) {
            const message = scheduledMessages.find(m => m.id === messageId);
            if (!message) return;
            
            if (confirm(`"${message.title}" 메시지를 승인하시겠습니까?\n\n예정된 시간에 자동으로 발송됩니다.\n발송 예정: ${formatDateTime(new Date(message.scheduledTime))}`)) {
                message.status = 'approved';
                message.approvedAt = new Date().toISOString();
                message.approvedBy = 'current_user'; // 실제로는 로그인한 사용자 ID
                
                saveScheduledMessages();
                renderScheduledMessages();
                
                showAlert(`✅ 메시지가 승인되었습니다!\n${formatDateTime(new Date(message.scheduledTime))}에 자동 발송됩니다.`);
                
                // 실제 발송 예약 (시뮬레이션)
                scheduleAutoSend(message);
            }
        }
        
        // 메시지 수정
        function modifyMessage(messageId) {
            const message = scheduledMessages.find(m => m.id === messageId);
            if (!message) return;
            
            // 모달로 수정 폼 표시
            showModifyModal(message);
        }
        
        // 수정 모달 표시
        function showModifyModal(message) {
            const modal = document.createElement('div');
            modal.className = 'modal active';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 700px;">
                    <div class="modal-header">
                        <h2>✏️ 예약 메시지 수정</h2>
                        <button class="modal-close" onclick="this.closest('.modal').remove()">×</button>
                    </div>
                    
                    <div class="form-group">
                        <label>제목</label>
                        <input type="text" id="modifyTitle" value="${message.title}" style="width:100%;padding:12px;border-radius:8px;border:1px solid rgba(255,255,255,0.3);background:rgba(255,255,255,0.1);color:white;font-size:16px;">
                    </div>
                    
                    <div class="form-group">
                        <label>내용</label>
                        <textarea id="modifyBody" style="width:100%;padding:12px;border-radius:8px;border:1px solid rgba(255,255,255,0.3);background:rgba(255,255,255,0.1);color:white;font-size:16px;min-height:150px;">${message.body}</textarea>
                    </div>
                    
                    <div class="form-group">
                        <label>발송 예정 시각</label>
                        <input type="datetime-local" id="modifyScheduledTime" value="${new Date(message.scheduledTime).toISOString().slice(0, 16)}" style="width:100%;padding:12px;border-radius:8px;border:1px solid rgba(255,255,255,0.3);background:rgba(255,255,255,0.1);color:white;font-size:16px;">
                    </div>
                    
                    <div style="display:flex;gap:10px;margin-top:20px;">
                        <button class="btn-secondary" style="flex:1;padding:12px;min-height:44px;" onclick="this.closest('.modal').remove()">취소</button>
                        <button class="btn-primary" style="flex:1;padding:12px;min-height:44px;" onclick="saveModifiedMessage(${message.id}, this.closest('.modal'))">저장</button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
        }
        
        // 수정된 메시지 저장
        function saveModifiedMessage(messageId, modal) {
            const message = scheduledMessages.find(m => m.id === messageId);
            if (!message) return;
            
            const title = document.getElementById('modifyTitle').value.trim();
            const body = document.getElementById('modifyBody').value.trim();
            const scheduledTime = document.getElementById('modifyScheduledTime').value;
            
            if (!title || !body || !scheduledTime) {
                alert('모든 필드를 입력해주세요.');
                return;
            }
            
            const newScheduledTime = new Date(scheduledTime);
            if (newScheduledTime <= new Date()) {
                alert('발송 시간은 현재 시간 이후여야 합니다.');
                return;
            }
            
            message.title = title;
            message.body = body;
            message.scheduledTime = newScheduledTime.toISOString();
            message.modifiedAt = new Date().toISOString();
            message.status = 'pending-approval'; // 수정 후 다시 승인 대기
            message.approvedAt = null;
            
            checkAndSetApprovalAlert(message);
            
            saveScheduledMessages();
            renderScheduledMessages();
            
            modal.remove();
            showAlert(`✅ 메시지가 수정되었습니다!\n다시 승인해주세요.`);
        }
        
        // 메시지 취소
        function cancelMessage(messageId) {
            const message = scheduledMessages.find(m => m.id === messageId);
            if (!message) return;
            
            if (confirm(`"${message.title}" 메시지를 취소하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`)) {
                message.status = 'cancelled';
                
                saveScheduledMessages();
                renderScheduledMessages();
                
                showAlert(`❌ 메시지가 취소되었습니다.`);
            }
        }
        
        // 자동 발송 예약 (실제로는 백엔드/cron job 필요)
        function scheduleAutoSend(message) {
            const scheduledTime = new Date(message.scheduledTime);
            const now = new Date();
            const delay = scheduledTime - now;
            
            if (delay > 0 && delay < 24 * 60 * 60 * 1000) { // 24시간 이내면 setTimeout 사용
                setTimeout(() => {
                    executeSendMessage(message);
                }, delay);
                
                console.log(`📅 메시지 자동 발송 예약됨: ${message.title} at ${formatDateTime(scheduledTime)}`);
            }
        }
        
        // 실제 메시지 발송 실행
        function executeSendMessage(message) {
            console.log('📤 메시지 발송 실행:', message.title);
            
            // 여기서 실제 발송 로직 실행
            // 예: sendPushNotification(message);
            
            message.status = 'sent';
            message.sentAt = new Date().toISOString();
            
            saveScheduledMessages();
            renderScheduledMessages();
            
            showAlert(`✅ "${message.title}" 메시지가 발송되었습니다!`);
        }
        
        // 사전 확인 시뮬레이션 (테스트용)
        function checkPendingApprovals() {
            const pending = scheduledMessages.filter(m => m.status === 'pending-approval');
            
            if (pending.length === 0) {
                showAlert('⚠️ 승인 대기 중인 메시지가 없습니다.');
                return;
            }
            
            const message = `🔔 사전 확인 알림\n\n아래 메시지들이 발송 예정입니다.\n승인 후 자동 발송됩니다.\n\n${pending.map(m => `• ${m.title} (${formatDateTime(new Date(m.scheduledTime))})`).join('\n')}`;
            
            alert(message);
            
            // 예약 관리 탭으로 이동
            switchTab('scheduled', document.querySelector('.tab-btn[onclick*="scheduled"]'));
        }
        
        // 날짜/시간 포맷팅
        function formatDateTime(date) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hour = String(date.getHours()).padStart(2, '0');
            const minute = String(date.getMinutes()).padStart(2, '0');
            
            return `${year}-${month}-${day} ${hour}:${minute}`;
        }
        
        // 메시지 발송 폼 수정 - 예약 발송 시 예약 메시지로 저장
        const originalSendMessage = window.sendMessage;
        window.sendMessage = function(event) {
            event.preventDefault();
            
            const sendType = document.getElementById('sendType').value;
            const title = document.getElementById('messageTitle').value;
            const body = document.getElementById('messageBody').value;
            const scheduleTime = document.getElementById('scheduleTime').value;
            
            // 선택된 고객 ID 수집
            const selectedCustomerIds = Array.from(selectedCustomersData || {})
                .filter(([id, selected]) => selected)
                .map(([id]) => parseInt(id));
            
            if (selectedCustomerIds.length === 0) {
                showAlert('수신자를 선택해주세요.', true);
                return;
            }
            
            if (sendType === 'scheduled') {
                if (!scheduleTime) {
                    showAlert('예약 시각을 입력해주세요.', true);
                    return;
                }
                
                const scheduledTime = new Date(scheduleTime);
                if (scheduledTime <= new Date()) {
                    showAlert('예약 시각은 현재 시간 이후여야 합니다.', true);
                    return;
                }
                
                // 예약 메시지 생성
                const message = createScheduledMessage(title, body, selectedCustomerIds, scheduledTime.toISOString());
                
                showAlert(`✅ 예약 메시지가 등록되었습니다!\n\n발송 전일 오전 10시에 사전 확인 알림을 받게 됩니다.`);
                
                // 폼 초기화
                document.getElementById('sendForm').reset();
                selectedCustomersData = {};
                
                // 예약 관리 탭으로 이동
                setTimeout(() => {
                    switchTab('scheduled', document.querySelector('.tab-btn[onclick*="scheduled"]'));
                }, 2000);
                
                return;
            }
            
            // 즉시 발송인 경우 기존 로직 실행
            if (typeof originalSendMessage === 'function') {
                originalSendMessage(event);
            }
        };
        
        // 초기화 시 예약 메시지 로드
        document.addEventListener('DOMContentLoaded', function() {
            loadScheduledMessages();
            
            // 예약 관리 탭 렌더링
            if (document.getElementById('scheduledTab')) {
                renderScheduledMessages();
            }
            
            // 기념일 로드
            loadAnniversaries();
            
            // 컨설턴트 정보 로드
            loadConsultantInfo();
            
            // 기념일 자동 발송 체크 (매일 아침 9시)
            checkUpcomingAnniversaries();
            setInterval(checkUpcomingAnniversaries, 10 * 60 * 1000); // 10분마다 체크
        });
        
        // ===== 기념일 자동 발송 체크 =====
        function checkUpcomingAnniversaries() {
            const now = new Date();
            const today = now.toISOString().split('T')[0];
            const todayDate = new Date(today);
            
            // 내일 날짜 계산
            const tomorrow = new Date(todayDate);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStr = tomorrow.toISOString().split('T')[0];
            
            // 전일 알림 저장소 가져오기
            let pendingNotifications = JSON.parse(localStorage.getItem('kfpc_pending_anniversary_notifications') || '{}');
            
            anniversaries.forEach(anniversary => {
                if (anniversary.active === false) return;
                
                const nextDate = getNextAnniversaryDate(anniversary);
                if (!nextDate) return;
                
                // === 전일 알림 체크 (오전 10시~10시30분) ===
                if (nextDate === tomorrowStr && now.getHours() === 10 && now.getMinutes() < 30) {
                    const notificationKey = `${anniversary.id}_${tomorrowStr}`;
                    
                    // 이미 알림을 보낸 경우 스킵
                    if (pendingNotifications[notificationKey]) return;
                    
                    // 전일 알림 표시
                    showDayBeforeNotification(anniversary, nextDate);
                    
                    // 알림 표시 기록
                    pendingNotifications[notificationKey] = {
                        anniversaryId: anniversary.id,
                        notifiedAt: now.toISOString(),
                        sendDate: nextDate,
                        status: 'pending' // pending, approved, cancelled
                    };
                    localStorage.setItem('kfpc_pending_anniversary_notifications', JSON.stringify(pendingNotifications));
                }
                
                // === 당일 발송 체크 ===
                if (nextDate === today) {
                    const notificationKey = `${anniversary.id}_${today}`;
                    const notification = pendingNotifications[notificationKey];
                    
                    // 전일 승인을 받지 않은 경우 발송하지 않음
                    if (!notification || notification.status !== 'approved') {
                        console.log(`⏸️ 기념일 ${anniversary.id}: 전일 승인이 없어 발송 건너뜀`);
                        return;
                    }
                    
                    const [hours, minutes] = anniversary.sendTime.split(':');
                    const sendTime = new Date();
                    sendTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
                    
                    // 발송 시간이 되었는지 체크
                    if (now >= sendTime && !anniversary.sentToday) {
                        sendAnniversaryMessage(anniversary);
                        anniversary.sentToday = true;
                        saveAnniversaries();
                        
                        // 발송 완료 후 알림 기록 삭제
                        delete pendingNotifications[notificationKey];
                        localStorage.setItem('kfpc_pending_anniversary_notifications', JSON.stringify(pendingNotifications));
                    }
                }
                
                // 매일 자정에 sentToday 플래그 초기화
                if (anniversary.sentToday && nextDate !== today) {
                    anniversary.sentToday = false;
                    saveAnniversaries();
                }
            });
            
            // 오래된 알림 기록 정리 (7일 이상 지난 것)
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            Object.keys(pendingNotifications).forEach(key => {
                const notification = pendingNotifications[key];
                if (new Date(notification.sendDate) < sevenDaysAgo) {
                    delete pendingNotifications[key];
                }
            });
            localStorage.setItem('kfpc_pending_anniversary_notifications', JSON.stringify(pendingNotifications));
        }
        
        // ===== 전일 알림 표시 =====
        function showDayBeforeNotification(anniversary, sendDate) {
            const customer = customers.find(c => c.id === anniversary.customerId);
            if (!customer) return;
            
            // 호칭 처리 함수
            function getHonorific(customer) {
                const name = customer.name || '';
                const position = customer.position || '';
                const honorificType = customer.honorific || '님';
                
                function hasFinalConsonant(text) {
                    if (!text) return false;
                    const lastChar = text.charCodeAt(text.length - 1);
                    return (lastChar - 0xAC00) % 28 !== 0;
                }
                
                switch(honorificType) {
                    case '님': return name + '님';
                    case '직함님': return position ? position + '님' : name + '님';
                    case '고객님': return name + ' 고객님';
                    case '씨': return name + '씨';
                    case '아야': return name + (hasFinalConsonant(name) ? '아' : '야');
                    case '이름만': return name;
                    default: return name + '님';
                }
            }
            
            // 메시지 미리보기 생성
            const consultant = getConsultantSignature();
            const previewTitle = anniversary.title
                .replace(/{honorific}/g, getHonorific(customer))
                .replace(/{name}/g, customer.name || '')
                .replace(/{position}/g, customer.position || '')
                .replace(/{company}/g, customer.company || '')
                .replace(/{consultant}/g, consultant);
            
            const previewContent = anniversary.content
                .replace(/{honorific}/g, getHonorific(customer))
                .replace(/{name}/g, customer.name || '')
                .replace(/{position}/g, customer.position || '')
                .replace(/{company}/g, customer.company || '')
                .replace(/{consultant}/g, consultant);
            
            // 전일 알림 모달 열기
            openDayBeforeModal(anniversary, customer, sendDate, previewTitle, previewContent);
        }
        
        // ===== 전일 알림 모달 관리 =====
        function openDayBeforeModal(anniversary, customer, sendDate, previewTitle, previewContent) {
            const info = anniversaryTypeInfo[anniversary.type];
            
            document.getElementById('dbAnniversaryId').value = anniversary.id;
            document.getElementById('dbCustomerId').value = customer.id;
            document.getElementById('dbSendDate').textContent = sendDate + ' (' + anniversary.sendTime + ')';
            document.getElementById('dbCustomerName').textContent = customer.name + (customer.company ? ` (${customer.company})` : '');
            document.getElementById('dbAnniversaryType').textContent = info.emoji + ' ' + info.name;
            document.getElementById('dbSendTime').textContent = anniversary.sendTime;
            document.getElementById('dbPreviewTitle').textContent = previewTitle;
            document.getElementById('dbPreviewContent').textContent = previewContent;
            
            document.getElementById('dayBeforeModal').classList.add('show');
        }
        
        function closeDayBeforeModal() {
            document.getElementById('dayBeforeModal').classList.remove('show');
        }
        
        function approveDayBeforeNotification() {
            const anniversaryId = parseInt(document.getElementById('dbAnniversaryId').value);
            const sendDate = document.getElementById('dbSendDate').textContent.split(' ')[0];
            
            // 승인 처리
            let pendingNotifications = JSON.parse(localStorage.getItem('kfpc_pending_anniversary_notifications') || '{}');
            const notificationKey = `${anniversaryId}_${sendDate}`;
            
            if (pendingNotifications[notificationKey]) {
                pendingNotifications[notificationKey].status = 'approved';
                pendingNotifications[notificationKey].approvedAt = new Date().toISOString();
                localStorage.setItem('kfpc_pending_anniversary_notifications', JSON.stringify(pendingNotifications));
                
                showAlert('✅ 발송이 승인되었습니다!\n\n내일 설정된 시각에 자동으로 발송됩니다.', 'success');
                closeDayBeforeModal();
            } else {
                showAlert('❌ 알림 정보를 찾을 수 없습니다.', 'error');
            }
        }
        
        function cancelDayBeforeNotification() {
            if (!confirm('정말 발송을 취소하시겠습니까?\n\n취소 후에는 자동 발송되지 않습니다.')) {
                return;
            }
            
            const anniversaryId = parseInt(document.getElementById('dbAnniversaryId').value);
            const sendDate = document.getElementById('dbSendDate').textContent.split(' ')[0];
            
            // 취소 처리
            let pendingNotifications = JSON.parse(localStorage.getItem('kfpc_pending_anniversary_notifications') || '{}');
            const notificationKey = `${anniversaryId}_${sendDate}`;
            
            if (pendingNotifications[notificationKey]) {
                pendingNotifications[notificationKey].status = 'cancelled';
                pendingNotifications[notificationKey].cancelledAt = new Date().toISOString();
                localStorage.setItem('kfpc_pending_anniversary_notifications', JSON.stringify(pendingNotifications));
                
                showAlert('🚫 발송이 취소되었습니다.', 'info');
                closeDayBeforeModal();
            }
        }
        
        function editDayBeforeMessage() {
            const anniversaryId = parseInt(document.getElementById('dbAnniversaryId').value);
            
            // 기념일 탭으로 이동
            switchTab('anniversary', document.querySelector('.tab-btn[onclick*="anniversary"]'));
            
            // 모달 닫기
            closeDayBeforeModal();
            
            // 해당 기념일 수정 모달 열기
            setTimeout(() => {
                editAnniversary(anniversaryId);
                showAlert('💡 수정 후 저장하시면 다시 전일 알림을 받게 됩니다.', 'info');
            }, 300);
        }
        
        // ===== 기념일 템플릿 미리보기 =====
        function showAnniversaryTemplates() {
            const modal = document.getElementById('anniversaryTemplatesModal');
            const listContainer = document.getElementById('templatePreviewList');
            
            // 카테고리 버튼 HTML 생성
            let categoryButtonsHtml = `
                <div style="margin-bottom: 20px;">
                    <div style="display: flex; gap: 10px; overflow-x: auto; padding: 10px 0; scrollbar-width: thin; -webkit-overflow-scrolling: touch;">
            `;
            
            // 카테고리별로 분류
            const categories = {
                'personal': { name: '📅 개인 기념일', types: ['birthday', 'wedding', 'company', 'custom'] },
                'onetime': { name: '🎉 일회성 이벤트', types: ['promotion', 'admission', 'pass', 'moving', 'opening'] },
                'holiday': { name: '🎆 명절', types: ['lunar-new-year', 'chuseok', 'christmas', 'new-year'] },
                'solar': { name: '🌱 24절기', types: ['solar-ipchun', 'solar-chunbun', 'solar-ipha', 'solar-haaji', 'solar-ipchu', 'solar-chubun', 'solar-ipdong', 'solar-dongji'] }
            };
            
            // 카테고리 버튼들 생성
            Object.entries(categories).forEach(([catKey, catInfo], index) => {
                categoryButtonsHtml += `
                    <button 
                        onclick="showCategoryTemplates('${catKey}')" 
                        id="cat-btn-${catKey}"
                        style="
                            flex-shrink: 0;
                            padding: 12px 20px;
                            background: ${index === 0 ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'rgba(255, 255, 255, 0.2)'};
                            border: 2px solid ${index === 0 ? '#667eea' : 'rgba(255, 255, 255, 0.3)'};
                            border-radius: 25px;
                            color: white;
                            font-size: 14px;
                            font-weight: bold;
                            cursor: pointer;
                            transition: all 0.3s;
                            white-space: nowrap;
                        "
                        onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(102, 126, 234, 0.4)';"
                        onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none';"
                    >
                        ${catInfo.name}
                    </button>
                `;
            });
            
            categoryButtonsHtml += `
                    </div>
                </div>
            `;
            
            // 상세 내용 표시 영역
            let detailsHtml = `
                <div id="templateDetailsArea" style="min-height: 300px;">
                    <!-- 선택된 카테고리의 템플릿들이 여기에 표시됩니다 -->
                </div>
            `;
            
            listContainer.innerHTML = categoryButtonsHtml + detailsHtml;
            
            // 첫 번째 카테고리 자동 표시
            showCategoryTemplates('personal');
            
            modal.classList.add('show');
        }
        
        function showCategoryTemplates(categoryKey) {
            // 모든 카테고리 버튼 스타일 초기화
            document.querySelectorAll('[id^="cat-btn-"]').forEach(btn => {
                btn.style.background = 'rgba(255, 255, 255, 0.2)';
                btn.style.border = '2px solid rgba(255, 255, 255, 0.3)';
            });
            
            // 선택된 버튼 활성화
            const selectedBtn = document.getElementById(`cat-btn-${categoryKey}`);
            if (selectedBtn) {
                selectedBtn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                selectedBtn.style.border = '2px solid #667eea';
            }
            
            const categories = {
                'personal': { name: '📅 개인 기념일', types: ['birthday', 'wedding', 'company', 'custom'] },
                'onetime': { name: '🎉 일회성 이벤트', types: ['promotion', 'admission', 'pass', 'moving', 'opening'] },
                'holiday': { name: '🎆 명절', types: ['lunar-new-year', 'chuseok', 'christmas', 'new-year'] },
                'solar': { name: '🌱 24절기', types: ['solar-ipchun', 'solar-chunbun', 'solar-ipha', 'solar-haaji', 'solar-ipchu', 'solar-chubun', 'solar-ipdong', 'solar-dongji'] }
            };
            
            const catInfo = categories[categoryKey];
            const detailsArea = document.getElementById('templateDetailsArea');
            
            let html = '';
            catInfo.types.forEach(type => {
                const template = anniversaryTemplates[type];
                const info = anniversaryTypeInfo[type];
                
                if (template && info) {
                    const itemId = `template-${categoryKey}-${type}`;
                    html += `
                    <div id="${itemId}" style="margin-bottom: 15px; border: 1px solid rgba(255,255,255,0.2); border-radius: 10px; overflow: hidden;">
                        <div style="background: rgba(102, 126, 234, 0.3); padding: 12px 15px; cursor: pointer; display: flex; justify-content: space-between; align-items: center;" onclick="toggleTemplate('${itemId}')">
                            <span style="font-weight: bold; font-size: 13px; color: #FFD700;">
                                ${info.icon} ${info.name}
                            </span>
                            <span id="${itemId}-arrow" style="font-size: 18px; color: #FFD700;">▼</span>
                        </div>
                        <div id="${itemId}-content" style="display: none; background: rgba(255,255,255,0.15); padding: 20px; border-top: 1px solid rgba(255,255,255,0.2);">
                            <div style="background: rgba(0,0,0,0.2); border-radius: 8px; padding: 15px; font-size: 14px; line-height: 1.7; white-space: pre-wrap; color: #ffffff;">
                                <div style="font-weight: bold; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 5px;">제목:</div>
                                ${template.title}
                                
                                <div style="font-weight: bold; margin: 15px 0 8px 0; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 5px;">내용:</div>
                                ${template.content}
                            </div>
                            <button onclick="scrollToTop()" style="margin-top: 15px; padding: 6px 12px; background: rgba(102, 126, 234, 0.5); border: none; border-radius: 6px; color: white; cursor: pointer; font-size: 12px; float: right;">
                                ⬆️ 위로가기
                            </button>
                            <div style="clear: both;"></div>
                        </div>
                    </div>`;
                }
            });
            
            detailsArea.innerHTML = html;
        }
        
        function toggleTemplate(itemId) {
            const content = document.getElementById(itemId + '-content');
            const arrow = document.getElementById(itemId + '-arrow');
            
            if (content.style.display === 'none') {
                content.style.display = 'block';
                arrow.textContent = '▲';
            } else {
                content.style.display = 'none';
                arrow.textContent = '▼';
            }
        }
        
        function scrollToTop() {
            const modal = document.getElementById('anniversaryTemplatesModal').querySelector('.modal-content');
            modal.scrollTo({ top: 0, behavior: 'smooth' });
        }
        
        function closeAnniversaryTemplatesModal() {
            document.getElementById('anniversaryTemplatesModal').classList.remove('show');
        }
        
        // ===== 가이드 모달 =====
        function openGuideModal() {
            document.getElementById('guideModal').classList.add('show');
        }
        
        function closeGuideModal() {
            document.getElementById('guideModal').classList.remove('show');
        }
        
        // ===== 기념일 메시지 발송 =====
        async function sendAnniversaryMessage(anniversary) {
            const customer = customers.find(c => c.id === anniversary.customerId);
            if (!customer) return;
            
            // 호칭 처리
            function getHonorific(customer) {
                const name = customer.name || '';
                const position = customer.position || '';
                const honorificType = customer.honorific || '님';
                
                function hasFinalConsonant(text) {
                    if (!text) return false;
                    const lastChar = text.charCodeAt(text.length - 1);
                    return (lastChar - 0xAC00) % 28 !== 0;
                }
                
                switch(honorificType) {
                    case '님': return name + '님';
                    case '직함님': return position ? position + '님' : name + '님';
                    case '고객님': return name + ' 고객님';
                    case '씨': return name + '씨';
                    case '아야': return name + (hasFinalConsonant(name) ? '아' : '야');
                    case '이름만': return name;
                    default: return name + '님';
                }
            }
            
            // 메시지 개인화
            const consultant = getConsultantSignature();
            
            const personalizedTitle = anniversary.title
                .replace(/{honorific}/g, getHonorific(customer))
                .replace(/{name}/g, customer.name || '')
                .replace(/{position}/g, customer.position || '')
                .replace(/{company}/g, customer.company || '')
                .replace(/{consultant}/g, consultant);
            
            const personalizedContent = anniversary.content
                .replace(/{honorific}/g, getHonorific(customer))
                .replace(/{name}/g, customer.name || '')
                .replace(/{position}/g, customer.position || '')
                .replace(/{company}/g, customer.company || '')
                .replace(/{consultant}/g, consultant);
            
            // 메시지 로그 저장
            const message = {
                id: Date.now(),
                customerId: customer.id,
                customerName: customer.name,
                company: customer.company,
                position: customer.position,
                title: personalizedTitle,
                body: personalizedContent,
                link: anniversary.link || null,
                image: anniversary.image || null,
                originalTitle: anniversary.title,
                originalBody: anniversary.content,
                sendType: 'anniversary',
                anniversaryType: anniversary.type,
                status: 'success',
                sentAt: new Date().toISOString(),
                createdAt: new Date().toISOString()
            };
            
            messages.unshift(message);
            await saveToDrive(FILES.messages, messages);
            
            // 알림 표시
            const info = anniversaryTypeInfo[anniversary.type];
            showAlert(`🎉 ${customer.name}님께 ${info.name} 메시지가 발송되었습니다!`, 'success');
            
            // 통계 업데이트
            updateStats();
            renderMessages();
        }
        
        // ================================================================
        // 예약 메시지 시스템 끝
        // ================================================================
        
        // ================================================================
        // 페이지 로드 시 자동 초기화
        // ================================================================
        window.addEventListener('load', () => {
            console.log('✅ 페이지 로드 완료');
            
            // Contact Picker API 지원 여부 확인 (휴대폰 연락처 직접 선택 기능)
            const contactPickerBtn = document.getElementById('contactPickerBtn');
            if (contactPickerBtn) {
                if (!('contacts' in navigator && 'ContactsManager' in window)) {
                    // 지원하지 않는 경우 버튼 비활성화 및 스타일 변경
                    contactPickerBtn.style.opacity = '0.5';
                    contactPickerBtn.style.cursor = 'not-allowed';
                    const lastDiv = contactPickerBtn.querySelector('div:last-child');
                    if (lastDiv) lastDiv.textContent = 'PC에서는 사용 불가';
                    console.log('ℹ️ Contact Picker API 미지원 (PC 환경)');
                } else {
                    console.log('✅ Contact Picker API 지원 (모바일 환경)');
                }
            }
            
            // localStorage에서 토큰 및 만료 시간 복원 시도
            const savedToken = localStorage.getItem('googleAccessToken');
            const savedExpiresAt = localStorage.getItem('tokenExpiresAt');
            
            if (savedToken && savedExpiresAt) {
                accessToken = savedToken;
                tokenExpiresAt = parseInt(savedExpiresAt);
                
                // 토큰 만료 여부 체크
                if (isTokenExpired()) {
                    console.log('⚠️ 저장된 토큰이 만료되었습니다. 자동 갱신 시도...');
                    // 만료된 경우 자동 갱신 시도 (조용히)
                    refreshTokenSilently();
                } else {
                    // 만료되지 않은 경우 정상 복원
                    isDriveConnected = true;
                    updateDriveStatus(true);
                    
                    // 자동 갱신 스케줄 설정
                    setupTokenAutoRefresh();
                    
                    const remainingMinutes = Math.floor((tokenExpiresAt - Date.now()) / (60 * 1000));
                    console.log(`✅ 저장된 토큰 복원 성공 (${remainingMinutes}분 후 만료)`);
                    
                    // 백그라운드에서 비동기 로딩 (페이지 표시를 차단하지 않음)
                    (async () => {
                        try {
                            // Firebase 로그인 체크
                            await checkFirebaseLogin();
                            
                            // 데이터 로드
                            await loadAllData();
                            
                            // 실시간 동기화 시작 (30초마다) ⭐ 최적화: 3초 → 30초
                            if (syncCheckInterval) clearInterval(syncCheckInterval);
                            syncCheckInterval = setInterval(checkForUpdates, 30000);
                            console.log('✅ 실시간 동기화 시작 (30초마다 체크) - 서버 부담 90% 감소');
                        } catch (error) {
                            console.error('❌ 초기화 오류:', error);
                        }
                    })();
                }
            } else {
                console.log('ℹ️ 저장된 토큰 없음 - Drive 연동 필요');
            }
        });
        
