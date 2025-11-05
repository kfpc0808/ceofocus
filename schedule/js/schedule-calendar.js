/* ========================================
   일정관리 캘린더 기능
   - FullCalendar 설정 및 렌더링
   - CRUD UI
   - 검색, 필터, 인쇄
======================================== */

let calendar = null;
let currentFilters = {
    types: [],
    status: [],
    important: false
};

// ========================================
// FullCalendar 초기화
// ========================================
function initializeCalendar() {
    const calendarEl = document.getElementById('calendar');
    
    calendar = new FullCalendar.Calendar(calendarEl, {
        // 기본 설정
        locale: 'ko',
        timeZone: 'Asia/Seoul',
        initialView: calendarData.userSettings.defaultView || 'timeGridWeek',
        
        // 모바일: 기본 5일 표시, PC: 7일
        dayCount: window.innerWidth <= 768 ? 5 : 7,
        
        // 헤더 툴바 - 상단에 연월 표시
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek'
        },
        
        // 제목 형식 - 요일을 날짜 우측에 배치
        titleFormat: function(date) {
            const year = date.date.year;
            const month = date.date.month + 1;
            const dayOfMonth = date.date.date; // 날짜 (1-31)
            const dayOfWeek = date.date.day; // 요일 (0-6)
            const weekday = ['일', '월', '화', '수', '목', '금', '토'][dayOfWeek];
            
            // 일간 뷰: "MM월 DD일 (요일)"
            if (dayOfMonth) {
                return `${month}월 ${dayOfMonth}일 (${weekday})`;
            }
            // 주간/월간 뷰: "YYYY년 MM월"
            return `${year}년 ${month}월`;
        },
        
        // 요일 헤더 형식 - 뷰별로 다르게
        dayHeaderContent: function(args) {
            const day = args.date.getDate();
            const weekday = ['일', '월', '화', '수', '목', '금', '토'][args.date.getDay()];
            
            // 월간 뷰: 요일만 표시 (월, 화, 수, 목, 금, 토, 일)
            if (args.view.type === 'dayGridMonth') {
                return {
                    html: `<div style="text-align:center;font-size:14px;font-weight:700;">${weekday}</div>`
                };
            }
            
            // 주간/일간 뷰: 날짜와 요일 표시 (5(수), 6(목))
            return {
                html: `<div style="text-align:center;font-size:14px;font-weight:700;">${day}<span style="font-size:12px;color:#666;">(${weekday})</span></div>`
            };
        },
        
        // 월간뷰 날짜 셀 - 숫자만 표시
        dayCellContent: function(args) {
            if (args.view.type === 'dayGridMonth') {
                return {
                    html: `<div class="fc-daygrid-day-number">${args.date.getDate()}</div>`
                };
            }
            return args.dayNumberText;
        },
        
        // 버튼 텍스트
        buttonText: {
            today: '오늘',
            month: '월',
            week: '주',
            day: '일',
            list: '목록'
        },
        
        // 시간 설정
        slotMinTime: '00:00:00',
        slotMaxTime: '24:00:00',
        slotDuration: '00:30:00',
        slotLabelInterval: '01:00',
        slotLabelFormat: {
            hour: 'numeric',     // 숫자만
            minute: undefined,   // 분 표시 안함
            omitZeroMinute: true,
            meridiem: false,     // AM/PM 표시 안함
            hour12: true         // 12시간 형식
        },
        // 시간 레이블을 숫자만 표시 (오전/오후 제거)
        slotLabelContent: function(arg) {
            let hour = arg.date.getHours();
            // 12시간 형식으로 변환 (1~12)
            if (hour === 0) hour = 12;
            else if (hour > 12) hour = hour - 12;
            return { html: hour };
        },
        
        // 주 설정
        firstDay: 0, // 일요일부터
        weekends: true,
        
        // 날짜 헤더 고정 (스크롤 시)
        stickyHeaderDates: true,
        stickyFooterScrollbar: true,
        
        // 높이
        height: 'auto',
        contentHeight: 'auto',
        
        // 일정 표시
        eventDisplay: 'block',
        displayEventTime: false,
        eventTimeFormat: {
            hour: '2-digit',
            minute: '2-digit',
            meridiem: false,
            hour12: false
        },
        
        // 드래그 앤 드롭
        editable: true,
        droppable: true,
        dragScroll: true,
        navLinks: true,
        navLinkDayClick: function(date, jsEvent) {
            calendar.changeView('timeGridDay', date);
        },
        
        // 선택 - 모바일에서 터치 오작동 방지
        selectable: false,  // 드래그 선택 비활성화
        selectMirror: false,
        
        // 현재 시간 표시
        nowIndicator: true,
        
        // 일정 제한
        dayMaxEvents: true,
        dayMaxEventRows: 3,
        
        // 이벤트
        events: [],
        
        // 이벤트 렌더링
        eventDidMount: function(info) {
            // 타입별 데이터 속성
            if (info.event.extendedProps.type) {
                info.el.setAttribute('data-type', info.event.extendedProps.type);
            }
            
            // 중요 일정
            if (info.event.extendedProps.important) {
                info.el.classList.add('important');
            }
            
            // 완료 일정
            if (info.event.extendedProps.completed) {
                info.el.classList.add('completed');
            }
            
            // 툴팁
            info.el.title = info.event.title;
            if (info.event.extendedProps.description) {
                info.el.title += '\n\n' + info.event.extendedProps.description;
            }
        },
        
        // 클릭 이벤트 (터치도 클릭으로 처리)
        dateClick: function(info) {
            openEventModal('add', info.date, info.allDay);
        },
        
        // select 제거 - 터치 오작동 방지
        
        eventClick: function(info) {
            showEventDetail(info.event);
        },
        
        // 드래그 이벤트
        eventDrop: function(info) {
            updateEventDates(info.event);
        },
        
        eventResize: function(info) {
            updateEventDates(info.event);
        },
        
        // 모바일 최적화
        windowResize: function(arg) {
            if (window.innerWidth < 768) {
                calendar.setOption('dayMaxEvents', 2);
            } else {
                calendar.setOption('dayMaxEvents', true);
            }
        }
    });
    
    calendar.render();
    console.log('✅ 캘린더 초기화 완료');
    
    // Pinch zoom 초기화
    initPinchZoom();
}

// ========================================
// Pinch Zoom으로 일자 수 조절
// ========================================
let currentDayCount = window.innerWidth <= 768 ? 5 : 7; // 모바일: 5일, 데스크톱: 7일
let touchDistance = 0;
let isPinching = false;

function initPinchZoom() {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;
    
    calendarEl.addEventListener('touchstart', function(e) {
        if (e.touches.length === 2) {
            isPinching = true;
            touchDistance = Math.hypot(
                e.touches[0].pageX - e.touches[1].pageX,
                e.touches[0].pageY - e.touches[1].pageY
            );
        }
    }, { passive: true });
    
    calendarEl.addEventListener('touchmove', function(e) {
        if (isPinching && e.touches.length === 2) {
            const newDistance = Math.hypot(
                e.touches[0].pageX - e.touches[1].pageX,
                e.touches[0].pageY - e.touches[1].pageY
            );
            
            const delta = newDistance - touchDistance;
            
            // 가로 방향 확대/축소 감지
            const horizontalDelta = Math.abs(e.touches[0].pageX - e.touches[1].pageX);
            const verticalDelta = Math.abs(e.touches[0].pageY - e.touches[1].pageY);
            
            // 가로 방향이 세로보다 클 때만 일자 수 조절
            if (horizontalDelta > verticalDelta * 1.5) {
                // 브라우저 기본 줌 방지
                e.preventDefault();
                
                if (Math.abs(delta) > 50) { // 임계값
                    if (delta > 0) {
                        // 벌리기 (줌인) - 일자 수 줄이기 (각 일자가 크게)
                        if (currentDayCount > 3) {
                            currentDayCount = Math.max(3, currentDayCount - 1);
                            updateCalendarDays();
                            touchDistance = newDistance;
                        }
                    } else {
                        // 모으기 (줌아웃) - 일자 수 늘리기 (더 많은 날)
                        if (currentDayCount < 14) {
                            currentDayCount = Math.min(14, currentDayCount + 1);
                            updateCalendarDays();
                            touchDistance = newDistance;
                        }
                    }
                }
            }
        }
    }, { passive: false }); // passive: false로 변경하여 preventDefault 가능하게
    
    calendarEl.addEventListener('touchend', function() {
        isPinching = false;
        touchDistance = 0;
    }, { passive: true });
    
    console.log('✅ Pinch zoom 초기화 완료 (3~14일 조절 가능)');
}

function updateCalendarDays() {
    if (!calendar) return;
    
    const currentDate = calendar.getDate();
    
    // 주간 뷰일 때만 적용
    if (calendar.view.type === 'timeGridWeek' || calendar.view.type.includes('Week')) {
        calendar.setOption('dayCount', currentDayCount);
        calendar.gotoDate(currentDate);
        
        showToast(`📅 ${currentDayCount}일 보기`);
    }
}

// ========================================
// 캘린더 렌더링
// ========================================
function renderCalendar() {
    if (!calendar) {
        initializeCalendar();
    }
    
    // 일정 데이터를 FullCalendar 형식으로 변환
    const events = calendarData.schedules
        .filter(schedule => filterSchedule(schedule))
        .map(schedule => ({
            id: schedule.id,
            title: (schedule.icon || '📅') + ' ' + schedule.title,  // 아이콘 추가
            start: schedule.all_day ? schedule.date : `${schedule.date}T${schedule.start_time}`,
            end: schedule.all_day ? schedule.end_date : `${schedule.end_date}T${schedule.end_time}`,
            allDay: schedule.all_day,
            backgroundColor: schedule.color || calendarData.colorSettings[schedule.type] || '#95a5a6',
            borderColor: schedule.color || calendarData.colorSettings[schedule.type] || '#95a5a6',
            extendedProps: {
                type: schedule.type,
                customer_name: schedule.customer_name,
                location: schedule.location,
                description: schedule.description,
                important: schedule.important,
                completed: schedule.completed,
                auto_generated: schedule.auto_generated,
                source: schedule.source,
                icon: schedule.icon  // 아이콘 저장
            }
        }));
    
    // 구글 캘린더 이벤트 추가
    if (googleCalendarEnabled && googleCalendarEvents) {
        const googleEvents = googleCalendarEvents.map(event => ({
            id: 'google_' + event.id,
            title: '📗 ' + event.summary,
            start: event.start.dateTime || event.start.date,
            end: event.end.dateTime || event.end.date,
            allDay: !event.start.dateTime,
            backgroundColor: '#E8E8E8',
            borderColor: '#CCCCCC',
            textColor: '#666666',
            editable: false,
            extendedProps: {
                type: '구글캘린더',
                source: 'google',
                description: event.description,
                location: event.location,
                googleEventId: event.id
            }
        }));
        
        events.push(...googleEvents);
        console.log(`📗 구글 캘린더 ${googleEvents.length}개 추가`);
    }
    
    // 이벤트 소스 교체
    calendar.removeAllEvents();
    calendar.addEventSource(events);
    
    console.log(`📅 총 ${events.length}개 일정 표시`);
}

// ========================================
// 필터링
// ========================================
function filterSchedule(schedule) {
    // 타입 필터
    if (currentFilters.types.length > 0) {
        if (!currentFilters.types.includes(schedule.type)) {
            return false;
        }
    }
    
    // 상태 필터
    if (currentFilters.status.length > 0) {
        const status = schedule.completed ? 'completed' : 'pending';
        if (!currentFilters.status.includes(status)) {
            return false;
        }
    }
    
    // 중요 필터
    if (currentFilters.important && !schedule.important) {
        return false;
    }
    
    return true;
}

// ========================================
// 일정 추가/수정 모달
// ========================================
function openEventModal(mode = 'add', date = new Date(), allDay = false, endDate = null) {
    const modal = document.getElementById('eventModal');
    const modalTitle = document.getElementById('modalTitle');
    const deleteBtn = document.getElementById('deleteEventBtn');
    
    // 모드 설정
    if (mode === 'add') {
        modalTitle.textContent = '새 일정';
        deleteBtn.style.display = 'none';
        currentEditingEvent = null;
        
        // 폼 초기화
        document.getElementById('eventTitle').value = '';
        
        // 아이콘 초기화 (안전하게)
        const selectedIcon = document.getElementById('selectedIcon');
        if (selectedIcon) selectedIcon.textContent = '📅';
        
        document.getElementById('eventType').value = '미팅';
        document.getElementById('eventColor').value = calendarData.colorSettings['미팅'];
        document.getElementById('eventAllDay').checked = allDay;
        document.getElementById('eventStartDate').value = formatDate(date);
        document.getElementById('eventStartTime').value = '09:00';
        document.getElementById('eventEndDate').value = formatDate(endDate || date);
        document.getElementById('eventEndTime').value = '10:00';
        document.getElementById('eventLocation').value = '';
        document.getElementById('eventDescription').value = '';
        document.getElementById('eventImportant').checked = false;
        document.getElementById('eventCompleted').checked = false;
        
        // 반복 초기화 (안전하게)
        const eventRecurrence = document.getElementById('eventRecurrence');
        if (eventRecurrence) {
            eventRecurrence.value = 'none';
            document.getElementById('eventRecurrenceEnd').value = '';
            const recurrenceEndGroup = document.getElementById('recurrenceEndGroup');
            if (recurrenceEndGroup) recurrenceEndGroup.style.display = 'none';
        }
        
        toggleTimeInputs(!allDay);
    }
    
    modal.classList.add('show');
}

function openEditModal(schedule) {
    const modal = document.getElementById('eventModal');
    const modalTitle = document.getElementById('modalTitle');
    const deleteBtn = document.getElementById('deleteEventBtn');
    
    modalTitle.textContent = '일정 수정';
    deleteBtn.style.display = 'inline-block';
    currentEditingEvent = schedule;
    
    // 폼 채우기
    document.getElementById('eventTitle').value = schedule.title || '';
    
    // 아이콘 설정 (안전하게)
    const selectedIcon = document.getElementById('selectedIcon');
    if (selectedIcon) selectedIcon.textContent = schedule.icon || '📅';
    
    document.getElementById('eventType').value = schedule.type || '미팅';
    document.getElementById('eventColor').value = schedule.color || calendarData.colorSettings[schedule.type];
    document.getElementById('eventAllDay').checked = schedule.all_day;
    document.getElementById('eventStartDate').value = schedule.date;
    document.getElementById('eventStartTime').value = schedule.start_time || '09:00';
    document.getElementById('eventEndDate').value = schedule.end_date || schedule.date;
    document.getElementById('eventEndTime').value = schedule.end_time || '10:00';
    document.getElementById('eventLocation').value = schedule.location || '';
    document.getElementById('eventDescription').value = schedule.description || '';
    document.getElementById('eventImportant').checked = schedule.important || false;
    document.getElementById('eventCompleted').checked = schedule.completed || false;
    
    // 반복 설정 (안전하게)
    const eventRecurrence = document.getElementById('eventRecurrence');
    if (eventRecurrence) {
        eventRecurrence.value = schedule.recurrence || 'none';
        document.getElementById('eventRecurrenceEnd').value = schedule.recurrence_end || '';
        const recurrenceEndGroup = document.getElementById('recurrenceEndGroup');
        if (recurrenceEndGroup) {
            recurrenceEndGroup.style.display = 
                (schedule.recurrence && schedule.recurrence !== 'none') ? 'block' : 'none';
        }
    }
    
    toggleTimeInputs(!schedule.all_day);
    modal.classList.add('show');
}

function closeEventModal() {
    document.getElementById('eventModal').classList.remove('show');
    currentEditingEvent = null;
}

// ========================================
// 종일 체크박스 처리
// ========================================
function toggleTimeInputs(show) {
    const startTimeGroup = document.getElementById('startTimeGroup');
    const endTimeGroup = document.getElementById('endTimeGroup');
    
    if (show) {
        startTimeGroup.style.display = 'block';
        endTimeGroup.style.display = 'block';
    } else {
        startTimeGroup.style.display = 'none';
        endTimeGroup.style.display = 'none';
    }
}

// ========================================
// 일정 저장
// ========================================
function saveEvent() {
    // 폼 데이터 수집
    const title = document.getElementById('eventTitle').value.trim();
    
    // 아이콘 가져오기 (안전하게)
    const selectedIcon = document.getElementById('selectedIcon');
    const icon = selectedIcon ? selectedIcon.textContent : '📅';
    
    const type = document.getElementById('eventType').value;
    const color = document.getElementById('eventColor').value;
    const allDay = document.getElementById('eventAllDay').checked;
    const startDate = document.getElementById('eventStartDate').value;
    const startTime = document.getElementById('eventStartTime').value;
    const endDate = document.getElementById('eventEndDate').value;
    const endTime = document.getElementById('eventEndTime').value;
    const location = document.getElementById('eventLocation').value.trim();
    const description = document.getElementById('eventDescription').value.trim();
    const important = document.getElementById('eventImportant').checked;
    const completed = document.getElementById('eventCompleted').checked;
    
    // 반복 설정 가져오기 (안전하게)
    const eventRecurrence = document.getElementById('eventRecurrence');
    const recurrence = eventRecurrence ? eventRecurrence.value : 'none';
    const recurrenceEnd = eventRecurrence ? document.getElementById('eventRecurrenceEnd').value : '';
    
    // 유효성 검사
    if (!title) {
        showToast('제목을 입력해주세요', 'error');
        return;
    }
    
    if (!startDate) {
        showToast('시작 날짜를 선택해주세요', 'error');
        return;
    }
    
    // 반복 종료일 검증
    if (recurrence !== 'none' && !recurrenceEnd) {
        showToast('반복 종료일을 선택해주세요', 'error');
        return;
    }
    
    // 일정 데이터
    const scheduleData = {
        title,
        icon,  // 아이콘 저장
        type,
        color,
        all_day: allDay,
        date: startDate,
        start_time: allDay ? null : startTime,
        end_date: endDate || startDate,
        end_time: allDay ? null : endTime,
        location,
        description,
        important,
        completed,
        recurrence,  // 반복 저장
        recurrence_end: recurrence !== 'none' ? recurrenceEnd : null,
        auto_generated: false,
        source: '수동입력'
    };
    
    if (currentEditingEvent) {
        // 수정
        updateSchedule(currentEditingEvent.id, scheduleData);
        showToast('✏️ 일정 수정 완료');
    } else {
        // 추가
        if (recurrence !== 'none') {
            // 반복 일정 생성
            createRecurringEvents(scheduleData);
            showToast(`✅ 반복 일정 생성 완료`);
        } else {
            addSchedule(scheduleData);
            showToast('✅ 일정 추가 완료');
        }
    }
    
    renderCalendar();
    closeEventModal();
}

// 반복 일정 생성 함수
function createRecurringEvents(scheduleData) {
    const startDate = new Date(scheduleData.date);
    const endDate = new Date(scheduleData.recurrence_end);
    const recurrence = scheduleData.recurrence;
    
    let currentDate = new Date(startDate);
    let count = 0;
    const MAX_EVENTS = 365; // 최대 365개까지만 생성
    
    while (currentDate <= endDate && count < MAX_EVENTS) {
        const eventData = {
            ...scheduleData,
            date: formatDate(currentDate),
            end_date: scheduleData.end_date ? formatDate(
                new Date(currentDate.getTime() + 
                    (new Date(scheduleData.end_date) - new Date(scheduleData.date)))
            ) : formatDate(currentDate),
            recurrence: 'none'  // 개별 일정은 반복 없음
        };
        
        addSchedule(eventData);
        count++;
        
        // 다음 날짜 계산
        switch (recurrence) {
            case 'daily':
                currentDate.setDate(currentDate.getDate() + 1);
                break;
            case 'weekly':
                currentDate.setDate(currentDate.getDate() + 7);
                break;
            case 'monthly':
                currentDate.setMonth(currentDate.getMonth() + 1);
                break;
            case 'yearly':
                currentDate.setFullYear(currentDate.getFullYear() + 1);
                break;
        }
    }
}

// ========================================
// 일정 삭제
// ========================================
function deleteEvent() {
    if (!currentEditingEvent) return;
    
    if (confirm('정말 이 일정을 삭제하시겠습니까?')) {
        deleteSchedule(currentEditingEvent.id);
        showToast('🗑️ 일정 삭제 완료');
        renderCalendar();
        closeEventModal();
    }
}

// ========================================
// 드래그로 날짜 변경
// ========================================
function updateEventDates(event) {
    const schedule = calendarData.schedules.find(s => s.id === event.id);
    if (!schedule) return;
    
    updateSchedule(event.id, {
        date: formatDate(event.start),
        start_time: event.allDay ? null : formatTime(event.start),
        end_date: formatDate(event.end || event.start),
        end_time: event.allDay ? null : formatTime(event.end || event.start),
        all_day: event.allDay
    });
    
    showToast('📅 일정 날짜 변경 완료');
}

// ========================================
// 일정 상세보기
// ========================================
function showEventDetail(event) {
    // 구글 캘린더 일정인 경우
    if (event.extendedProps.source === 'google') {
        const modal = document.getElementById('eventDetailModal');
        
        document.getElementById('detailTitle').textContent = event.title.replace('📗 ', '');
        document.getElementById('detailType').textContent = '📗 구글 캘린더 (읽기 전용)';
        
        const startDateStr = formatDateKor(event.start);
        const endDateStr = event.end && formatDate(event.end) !== formatDate(event.start) ? 
            ' ~ ' + formatDateKor(event.end) : '';
        document.getElementById('detailDate').textContent = startDateStr + endDateStr;
        
        if (event.allDay) {
            document.getElementById('detailTime').textContent = '종일';
        } else {
            document.getElementById('detailTime').textContent = 
                `${formatTime(event.start)} ~ ${formatTime(event.end)}`;
        }
        
        const locationRow = document.getElementById('detailLocationRow');
        if (event.extendedProps.location) {
            document.getElementById('detailLocation').textContent = event.extendedProps.location;
            locationRow.style.display = 'flex';
        } else {
            locationRow.style.display = 'none';
        }
        
        const descriptionRow = document.getElementById('detailDescriptionRow');
        if (event.extendedProps.description) {
            document.getElementById('detailDescription').textContent = event.extendedProps.description;
            descriptionRow.style.display = 'flex';
        } else {
            descriptionRow.style.display = 'none';
        }
        
        document.getElementById('detailStatus').textContent = '구글 캘린더에서 관리';
        
        // 버튼 숨기기 (읽기 전용)
        document.getElementById('shareKakaoBtn').style.display = 'none';
        document.getElementById('editEventBtn').style.display = 'none';
        document.getElementById('completeToggleBtn').style.display = 'none';
        
        modal.classList.add('show');
        return;
    }
    
    // 일반 일정 처리
    const schedule = calendarData.schedules.find(s => s.id === event.id);
    if (!schedule) return;
    
    const modal = document.getElementById('eventDetailModal');
    
    // 제목
    document.getElementById('detailTitle').textContent = schedule.title;
    
    // 타입
    const typeIcons = {
        '상령일': '🎂',
        '보험만기일': '⭐',
        '생일': '🎁',
        '결혼기념일': '💑',
        '미팅': '🤝',
        '상담': '📞',
        '기타': '📌'
    };
    document.getElementById('detailType').textContent = 
        (typeIcons[schedule.type] || '') + ' ' + schedule.type;
    
    // 날짜
    const startDateStr = formatDateKor(schedule.date);
    const endDateStr = schedule.end_date !== schedule.date ? 
        ' ~ ' + formatDateKor(schedule.end_date) : '';
    document.getElementById('detailDate').textContent = startDateStr + endDateStr;
    
    // 시간
    if (schedule.all_day) {
        document.getElementById('detailTime').textContent = '종일';
    } else {
        document.getElementById('detailTime').textContent = 
            `${schedule.start_time} ~ ${schedule.end_time}`;
    }
    
    // 장소
    const locationRow = document.getElementById('detailLocationRow');
    if (schedule.location) {
        document.getElementById('detailLocation').textContent = schedule.location;
        locationRow.style.display = 'flex';
    } else {
        locationRow.style.display = 'none';
    }
    
    // 메모
    const descriptionRow = document.getElementById('detailDescriptionRow');
    if (schedule.description) {
        document.getElementById('detailDescription').textContent = schedule.description;
        descriptionRow.style.display = 'flex';
    } else {
        descriptionRow.style.display = 'none';
    }
    
    // 상태
    let statusText = '';
    if (schedule.important) statusText += '중요 ';  // 별 제거
    if (schedule.completed) statusText += '✅ 완료 ';
    if (schedule.auto_generated) statusText += '🤖 자동생성 ';
    if (!statusText) statusText = '일반';
    document.getElementById('detailStatus').textContent = statusText;
    
    // 완료 토글 버튼
    const completeBtn = document.getElementById('completeToggleBtn');
    completeBtn.textContent = schedule.completed ? '⏮️ 완료 취소' : '✅ 완료';
    completeBtn.onclick = () => toggleComplete(schedule);
    completeBtn.style.display = 'inline-block';
    
    // 수정 버튼
    const editBtn = document.getElementById('editEventBtn');
    editBtn.style.display = 'inline-block';
    editBtn.onclick = () => {
        closeEventDetailModal();
        openEditModal(schedule);
    };
    
    // 카카오톡 공유 버튼
    const shareKakaoBtn = document.getElementById('shareKakaoBtn');
    shareKakaoBtn.style.display = 'inline-block';
    shareKakaoBtn.onclick = () => {
        shareToKakao(schedule);
    };
    
    modal.classList.add('show');
}

function closeEventDetailModal() {
    document.getElementById('eventDetailModal').classList.remove('show');
}

// ========================================
// 완료 토글
// ========================================
function toggleComplete(schedule) {
    updateSchedule(schedule.id, {
        completed: !schedule.completed
    });
    
    showToast(schedule.completed ? '✅ 완료 처리' : '⏮️ 완료 취소');
    renderCalendar();
    closeEventDetailModal();
}

// ========================================
// 검색
// ========================================
function performSearch() {
    const query = document.getElementById('searchInput').value.trim();
    const clearBtn = document.getElementById('searchClear');
    
    if (!query) {
        clearBtn.style.display = 'none';
        renderCalendar();
        return;
    }
    
    clearBtn.style.display = 'inline-block';
    
    const results = searchSchedules(query);
    
    // 검색 결과만 표시
    const events = results.map(schedule => ({
        id: schedule.id,
        title: schedule.title,
        start: schedule.all_day ? schedule.date : `${schedule.date}T${schedule.start_time}`,
        end: schedule.all_day ? schedule.end_date : `${schedule.end_date}T${schedule.end_time}`,
        allDay: schedule.all_day,
        backgroundColor: schedule.color || calendarData.colorSettings[schedule.type],
        extendedProps: {
            type: schedule.type,
            important: schedule.important,
            completed: schedule.completed
        }
    }));
    
    calendar.removeAllEvents();
    calendar.addEventSource(events);
    
    showToast(`🔍 ${results.length}개 검색 결과`);
}

function clearSearch() {
    document.getElementById('searchInput').value = '';
    document.getElementById('searchClear').style.display = 'none';
    renderCalendar();
}

// ========================================
// 필터
// ========================================
function openFilterPanel() {
    document.getElementById('filterPanel').classList.add('show');
}

function closeFilterPanel() {
    document.getElementById('filterPanel').classList.remove('show');
}

function applyFilters() {
    // 타입 필터
    const typeCheckboxes = document.querySelectorAll('.filter-panel input[type="checkbox"][value]');
    currentFilters.types = [];
    typeCheckboxes.forEach(cb => {
        if (cb.checked && cb.value !== 'pending' && cb.value !== 'completed' && cb.value !== 'important') {
            currentFilters.types.push(cb.value);
        }
    });
    
    // 상태 필터
    currentFilters.status = [];
    if (document.querySelector('.filter-panel input[value="pending"]').checked) {
        currentFilters.status.push('pending');
    }
    if (document.querySelector('.filter-panel input[value="completed"]').checked) {
        currentFilters.status.push('completed');
    }
    
    // 중요 필터
    currentFilters.important = document.querySelector('.filter-panel input[value="important"]').checked;
    
    renderCalendar();
    closeFilterPanel();
    
    const filterCount = currentFilters.types.length + 
                       (currentFilters.status.length < 2 ? 1 : 0) + 
                       (currentFilters.important ? 1 : 0);
    
    if (filterCount > 0) {
        showToast(`🔍 ${filterCount}개 필터 적용`);
    }
}

function resetFilters() {
    // 모든 체크박스 체크
    document.querySelectorAll('.filter-panel input[type="checkbox"]').forEach(cb => {
        cb.checked = true;
    });
    
    currentFilters = {
        types: [],
        status: [],
        important: false
    };
    
    renderCalendar();
    showToast('🔄 필터 초기화');
}

// ========================================
// 인쇄
// ========================================
function printCalendar() {
    window.print();
}

// ========================================
// 뷰 변경
// ========================================
function changeView(viewName) {
    if (calendar) {
        calendar.changeView(viewName);
        
        // 메뉴 활성화 상태 변경
        document.querySelectorAll('.menu-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`[data-view="${viewName}"]`)?.classList.add('active');
        
        closeViewMenu();
    }
}

function openViewMenu() {
    document.getElementById('viewMenu').classList.add('show');
}

function closeViewMenu() {
    document.getElementById('viewMenu').classList.remove('show');
}

// ========================================
// 설정
// ========================================
function openSettingsModal() {
    const modal = document.getElementById('settingsModal');
    
    // 색상 설정 로드
    document.querySelectorAll('.color-picker').forEach(picker => {
        const type = picker.dataset.type;
        picker.value = calendarData.colorSettings[type];
    });
    
    // 기본 설정 로드
    document.getElementById('defaultView').value = calendarData.userSettings.defaultView;
    document.getElementById('defaultStartTime').value = calendarData.userSettings.startTime;
    document.getElementById('defaultEndTime').value = calendarData.userSettings.endTime;
    
    // 사용자 정보 로드
    if (calendarData.userInfo) {
        document.getElementById('userName').value = calendarData.userInfo.name || '';
        document.getElementById('userTitle').value = calendarData.userInfo.title || '';
        document.getElementById('kakaoMessage').value = calendarData.userInfo.kakaoMessage || '';
        document.getElementById('kakaoUrl').value = calendarData.userInfo.kakaoUrl || '';
        updateUserInfoPreview();
    }
    
    modal.classList.add('show');
}

function closeSettingsModal() {
    document.getElementById('settingsModal').classList.remove('show');
}

// 받침 판단 함수 (이/가 자동 선택)
function getSubjectParticle(word) {
    if (!word || word.length === 0) return '이';
    
    const lastChar = word.charAt(word.length - 1);
    const lastCharCode = lastChar.charCodeAt(0);
    
    // 한글이 아니면 '이' 반환
    if (lastCharCode < 0xAC00 || lastCharCode > 0xD7A3) {
        return '이';
    }
    
    // 한글의 받침 유무 판단
    const hasJongseong = (lastCharCode - 0xAC00) % 28 !== 0;
    
    return hasJongseong ? '이' : '가';
}

// 사용자 정보 미리보기 업데이트
function updateUserInfoPreview() {
    const userName = document.getElementById('userName').value || '홍길동';
    const userTitle = document.getElementById('userTitle').value;
    const preview = document.getElementById('userInfoPreview');
    
    // 받침에 따라 '이/가' 자동 선택
    const particle = getSubjectParticle(userTitle || userName);
    
    if (userTitle) {
        preview.textContent = `💼 ${userName} ${userTitle}${particle} 공유한 일정입니다.`;
    } else {
        preview.textContent = `💼 ${userName}${particle} 공유한 일정입니다.`;
    }
}


function saveSettings() {
    // 색상 설정 저장
    document.querySelectorAll('.color-picker').forEach(picker => {
        const type = picker.dataset.type;
        updateColorSettings(type, picker.value);
    });
    
    // 기본 설정 저장
    updateUserSettings({
        defaultView: document.getElementById('defaultView').value,
        startTime: document.getElementById('defaultStartTime').value,
        endTime: document.getElementById('defaultEndTime').value
    });
    
    // 사용자 정보 저장
    const userName = document.getElementById('userName').value.trim();
    if (userName) {
        calendarData.userInfo = {
            name: userName,
            title: document.getElementById('userTitle').value.trim(),
            kakaoMessage: document.getElementById('kakaoMessage').value.trim(),
            kakaoUrl: document.getElementById('kakaoUrl').value.trim()
        };
        saveSchedulesToDrive(); // 드라이브에 저장
    } else {
        showToast('⚠️ 이름을 입력해주세요', 'error');
        return;
    }
    
    // 캘린더 재설정
    if (calendar) {
        calendar.setOption('slotMinTime', calendarData.userSettings.startTime);
        calendar.setOption('slotMaxTime', calendarData.userSettings.endTime);
    }
    
    renderCalendar();
    closeSettingsModal();
    showToast('⚙️ 설정 저장 완료');
}

function resetSettings() {
    if (confirm('설정을 초기화하시겠습니까?')) {
        calendarData.colorSettings = {
            '상령일': '#FF6B6B',
            '보험만기일': '#FF9500',
            '생일': '#9B59B6',
            '결혼기념일': '#FFB6C1',
            '미팅': '#FFD93D',
            '상담': '#6BCF7F',
            '기타': '#95a5a6'
        };
        
        calendarData.userSettings = {
            defaultView: 'timeGridWeek',
            startTime: '09:00',
            endTime: '18:00',
            slotDuration: '00:30:00'
        };
        
        scheduleAutoSave();
        location.reload();
    }
}

// ========================================
// 유틸리티 함수
// ========================================
function formatDate(date) {
    if (!date) return '';
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatTime(date) {
    if (!date) return '';
    const d = new Date(date);
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

function formatDateKor(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
}

// ========================================
// 이벤트 리스너
// ========================================
document.addEventListener('DOMContentLoaded', () => {
    // 캘린더 초기화
    initializeCalendar();
    
    // 검색
    document.getElementById('searchBtn')?.addEventListener('click', performSearch);
    document.getElementById('searchInput')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch();
    });
    document.getElementById('searchClear')?.addEventListener('click', clearSearch);
    
    // 필터
    document.getElementById('filterBtn')?.addEventListener('click', openFilterPanel);
    document.getElementById('filterNavBtn')?.addEventListener('click', openFilterPanel);
    document.getElementById('closeFilter')?.addEventListener('click', closeFilterPanel);
    document.getElementById('filterApply')?.addEventListener('click', applyFilters);
    document.getElementById('filterReset')?.addEventListener('click', resetFilters);
    
    // 인쇄
    document.getElementById('printBtn')?.addEventListener('click', printCalendar);
    
    // 하단 네비게이션
    document.getElementById('todayBtn')?.addEventListener('click', () => {
        if (calendar) calendar.today();
    });
    
    document.getElementById('viewBtn')?.addEventListener('click', () => {
        const menu = document.getElementById('viewMenu');
        menu.classList.toggle('show');
    });
    
    document.getElementById('addBtn')?.addEventListener('click', () => {
        openEventModal('add', new Date(), false);
    });
    
    document.getElementById('settingsBtn')?.addEventListener('click', openSettingsModal);
    
    // 뷰 메뉴
    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', () => {
            const view = item.dataset.view;
            changeView(view);
        });
    });
    
    // 모달 닫기
    document.getElementById('closeModal')?.addEventListener('click', closeEventModal);
    document.getElementById('cancelEventBtn')?.addEventListener('click', closeEventModal);
    document.getElementById('closeDetailModal')?.addEventListener('click', closeEventDetailModal);
    document.getElementById('closeDetailBtn')?.addEventListener('click', closeEventDetailModal);
    document.getElementById('closeSettingsModal')?.addEventListener('click', closeSettingsModal);
    
    // 일정 저장/삭제
    document.getElementById('saveEventBtn')?.addEventListener('click', saveEvent);
    document.getElementById('deleteEventBtn')?.addEventListener('click', deleteEvent);
    
    const deleteDetailBtn = document.getElementById('deleteDetailBtn');
    if (deleteDetailBtn) {
        deleteDetailBtn.addEventListener('click', () => {
            // 상세보기 모달에서 삭제
            const currentSchedule = calendarData.schedules.find(s => 
                s.title === document.getElementById('detailTitle').textContent
            );
            if (currentSchedule && confirm('이 일정을 삭제하시겠습니까?')) {
                deleteSchedule(currentSchedule.id);
                showToast('🗑️ 일정이 삭제되었습니다');
                closeEventDetailModal();
                renderCalendar();
            }
        });
    }
    
    // 아이콘 선택기
    const iconPickerBtn = document.getElementById('iconPickerBtn');
    if (iconPickerBtn) {
        iconPickerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const picker = document.getElementById('iconPicker');
            if (picker) {
                picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
            }
        });
    }
    
    // 아이콘 선택
    document.querySelectorAll('.icon-option').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const icon = e.target.dataset.icon;
            const selectedIcon = document.getElementById('selectedIcon');
            if (selectedIcon) {
                selectedIcon.textContent = icon;
            }
            const picker = document.getElementById('iconPicker');
            if (picker) {
                picker.style.display = 'none';
            }
        });
    });
    
    // 아이콘 선택기 외부 클릭 시 닫기
    document.addEventListener('click', (e) => {
        const picker = document.getElementById('iconPicker');
        const btn = document.getElementById('iconPickerBtn');
        if (picker && btn && !picker.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
            picker.style.display = 'none';
        }
    });
    
    // 반복 옵션 변경 시 반복 종료일 표시/숨김
    const eventRecurrence = document.getElementById('eventRecurrence');
    if (eventRecurrence) {
        eventRecurrence.addEventListener('change', (e) => {
            const recurrenceEndGroup = document.getElementById('recurrenceEndGroup');
            if (recurrenceEndGroup) {
                if (e.target.value !== 'none') {
                    recurrenceEndGroup.style.display = 'block';
                    // 기본 종료일 설정 (1년 후)
                    const eventRecurrenceEnd = document.getElementById('eventRecurrenceEnd');
                    if (eventRecurrenceEnd && !eventRecurrenceEnd.value) {
                        const oneYearLater = new Date();
                        oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
                        eventRecurrenceEnd.value = formatDate(oneYearLater);
                    }
                } else {
                    recurrenceEndGroup.style.display = 'none';
                }
            }
        });
    }
    
    // 설정 저장
    document.getElementById('saveSettings')?.addEventListener('click', saveSettings);
    document.getElementById('resetSettings')?.addEventListener('click', resetSettings);
    
    // 사용자 정보 미리보기 업데이트
    document.getElementById('userName')?.addEventListener('input', updateUserInfoPreview);
    document.getElementById('userTitle')?.addEventListener('input', updateUserInfoPreview);
    
    // 구글 캘린더 동기화
    document.getElementById('syncGoogleCalendarBtn')?.addEventListener('click', async () => {
        if (googleCalendarEnabled) {
            stopGoogleCalendarSync();
            document.getElementById('syncGoogleCalendarBtn').textContent = '📗';
            document.getElementById('refreshGoogleCalendarBtn').style.display = 'none';
        } else {
            const success = await startGoogleCalendarSync();
            if (success) {
                document.getElementById('syncGoogleCalendarBtn').textContent = '📕';
                document.getElementById('refreshGoogleCalendarBtn').style.display = 'inline-block';
            }
        }
    });
    
    document.getElementById('refreshGoogleCalendarBtn')?.addEventListener('click', refreshGoogleCalendar);
    
    // 종일 체크박스
    document.getElementById('eventAllDay')?.addEventListener('change', (e) => {
        toggleTimeInputs(!e.target.checked);
    });
    
    // 타입 변경 시 색상 자동 변경
    document.getElementById('eventType')?.addEventListener('change', (e) => {
        const type = e.target.value;
        document.getElementById('eventColor').value = calendarData.colorSettings[type] || '#95a5a6';
    });
    
    // 모달 배경 클릭 시 닫기
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('show');
            }
        });
    });
    
    // 뷰 메뉴 외부 클릭 시 닫기
    document.addEventListener('click', (e) => {
        const viewMenu = document.getElementById('viewMenu');
        const viewBtn = document.getElementById('viewBtn');
        if (viewMenu.classList.contains('show') && 
            !viewMenu.contains(e.target) && 
            !viewBtn.contains(e.target)) {
            closeViewMenu();
        }
    });
    
    console.log('✅ 캘린더 이벤트 리스너 등록 완료');
});
