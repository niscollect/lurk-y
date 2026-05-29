/* ==========================================
   RIVAL CORE CONTROLLER
   Pure Client-side Logic & LocalStorage Storage
   ========================================== */

// --- GLOBAL VARIABLES & STATE ---
let activeRoomId = null;
let currentSortColumn = 'this_week';
let currentSortDirection = 'desc';

// --- UTILITIES & HELPERS ---
const generateId = () => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
const generateRoomCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

// Toast notification helper
const showToast = (message, type = 'info') => {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
};

// LocalStorage helpers
const getRoomsFromStorage = () => JSON.parse(localStorage.getItem('rival_rooms')) || [];
const saveRoomsToStorage = (rooms) => localStorage.setItem('rival_rooms', JSON.stringify(rooms));
const getActiveRoomId = () => localStorage.getItem('rival_active_room');
const setActiveRoomId = (roomId) => {
  if (roomId) {
    localStorage.setItem('rival_active_room', roomId);
  } else {
    localStorage.removeItem('rival_active_room');
  }
};

// Date Formatters & Math in user's local timezone
const getLocalDateString = (dateObj = new Date()) => dateObj.toLocaleDateString('sv'); // Outputs YYYY-MM-DD in local timezone

const getLastMonday = () => {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
  const monday = new Date(now.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
};

const getStartOfMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
};

const getDaysInRange = (startDate, endDate) => {
  const days = [];
  let current = new Date(startDate);
  while (current <= endDate) {
    days.push(getLocalDateString(current));
    current.setDate(current.getDate() + 1);
  }
  return days;
};

// --- ROUTING ENGINE ---
const renderSavedRoomsList = () => {
  const container = document.getElementById('saved-rooms-container');
  const listDiv = document.getElementById('saved-rooms-list');
  const rooms = getRoomsFromStorage();

  if (rooms.length > 0) {
    container.classList.remove('hidden');
    listDiv.innerHTML = '';
    
    rooms.forEach(room => {
      const item = document.createElement('div');
      item.className = 'saved-room-item';
      item.onclick = () => navigateToRoom(room.room_id);
      item.innerHTML = `
        <div class="saved-room-info">
          <span class="saved-room-name">${room.room_name}</span>
          <span class="saved-room-meta">
            Code: <span class="saved-room-code-tag">${room.room_id}</span> · ${room.members.length} member(s)
          </span>
        </div>
        <span class="saved-room-action">→</span>
      `;
      listDiv.appendChild(item);
    });
  } else {
    container.classList.add('hidden');
  }
};

const navigateToLanding = () => {
  activeRoomId = null;
  setActiveRoomId(null);
  window.history.pushState(null, '', '/');
  document.getElementById('landing-page').classList.add('active');
  document.getElementById('room-page').classList.remove('active');
  renderSavedRoomsList();
};

const navigateToRoom = async (roomId) => {
  activeRoomId = roomId;
  setActiveRoomId(roomId);
  window.history.pushState(null, '', `/room/${roomId}`);
  document.getElementById('landing-page').classList.remove('active');
  document.getElementById('room-page').classList.add('active');
  
  // Render local state instantly for fast UI feel
  initRoomView(roomId);

  // Sync with server in the background
  try {
    const res = await fetch(`/api/room?id=${roomId}`);
    if (res.ok) {
      const serverRoom = await res.json();
      const rooms = getRoomsFromStorage();
      const idx = rooms.findIndex(r => r.room_id === roomId);
      if (idx !== -1) {
        const localRoom = rooms[idx];
        const mergedMembers = serverRoom.members.map(serverMem => {
          const localMem = localRoom?.members.find(m => m.member_id === serverMem.member_id);
          return {
            ...serverMem,
            cache: localMem?.cache || serverMem.cache || { last_fetched: 0 },
            leetcode_error: localMem?.leetcode_error || false,
            codeforces_error: localMem?.codeforces_error || false
          };
        });
        
        rooms[idx] = {
          ...serverRoom,
          members: mergedMembers
        };
        saveRoomsToStorage(rooms);
        
        // Re-render UI with latest synced state
        initRoomView(roomId);
      }
    }
  } catch (err) {
    // Fail silently, utilizing local storage cache
  }
};

const handleRouting = () => {
  const path = window.location.pathname;
  const match = path.match(/^\/room\/([A-Za-z0-9]{6})$/);
  
  if (match) {
    const roomId = match[1].toUpperCase();
    const rooms = getRoomsFromStorage();
    const exists = rooms.find(r => r.room_id === roomId);
    
    if (exists) {
      navigateToRoom(roomId);
    } else {
      // Check if URL parameters have prefill details (join link)
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has('members') || urlParams.has('name')) {
        // Pre-fill the join room form and switch to join tab
        switchLandingTab('join');
        document.getElementById('join-room-code').value = roomId;
        document.getElementById('join-prefill-indicator').classList.remove('hidden');
        
        // Retain pre-filled query inside state
        window.sharedRoomData = {
          code: roomId,
          name: urlParams.get('name') || 'Shared Room',
          members: urlParams.get('members') || ''
        };
        showToast('Room link loaded! Complete your details to join your friends.', 'info');
      } else {
        showToast('Room not found locally. Create a new one or join with code.', 'warning');
        navigateToLanding();
      }
    }
  } else {
    // If active room exists, redirect to it
    const savedActive = getActiveRoomId();
    if (savedActive) {
      const rooms = getRoomsFromStorage();
      if (rooms.find(r => r.room_id === savedActive)) {
        navigateToRoom(savedActive);
        return;
      }
    }
    navigateToLanding();
  }
};

// --- INITIALIZE ROOM VIEW & RENDER ---
const initRoomView = (roomId) => {
  const rooms = getRoomsFromStorage();
  const room = rooms.find(r => r.room_id === roomId);
  if (!room) return;

  // Set Header Meta
  document.getElementById('room-name-display').innerText = room.room_name;
  document.getElementById('room-code-display').innerText = room.room_id;
  document.getElementById('member-count-val').innerText = room.members.length;

  // Run weekly snapshot check before calculations
  checkWeeklyReset(room);

  // Compute all stats client-side
  const computedMembers = room.members.map(member => computeMemberStats(member, room.manual_logs));
  
  // Sort and cache computed members into current view state
  window.computedRoomMembers = computedMembers;
  window.currentRoomManualLogs = room.manual_logs.filter(log => log.member_id === getSelfId(room));

  // Render Sections
  renderLeaderboard();
  renderPlatformBreakdowns();
  renderAttendanceGrid();
  renderGoalsPanel();
  renderRoomStatsPanel();
  renderManualLogsList();

  // Find last sync timestamp
  const syncs = room.members.map(m => m.cache?.last_fetched).filter(t => t);
  if (syncs.length > 0) {
    const minSync = new Date(Math.min(...syncs));
    document.getElementById('last-sync-val').innerText = minSync.toLocaleTimeString() + ' ' + minSync.toLocaleDateString();
  } else {
    document.getElementById('last-sync-val').innerText = 'Never';
  }

  // Trigger auto sync for stale cache on initial load (Daily Flush Logic)
  triggerDailyFlushSync(room);
};

// Find is_self member ID
const getSelfId = (room) => {
  const selfMember = room.members.find(m => m.is_self);
  return selfMember ? selfMember.member_id : null;
};

// --- CORE STAT COMP_ENGINE ---
const computeMemberStats = (member, allManualLogs) => {
  const solvesByDate = {};
  
  // Format Today's Date String
  const todayStr = getLocalDateString();
  
  // 1. Process LeetCode Cache
  let lcAllTime = 0;
  if (member.leetcode_username && member.cache?.leetcode) {
    const lcData = member.cache.leetcode;
    
    // Total solved by difficulty
    const allStats = lcData.submitStats?.acSubmissionNum?.find(item => item.difficulty === 'All');
    lcAllTime = allStats ? allStats.count : 0;

    // Daily solves calendar
    const calendar = JSON.parse(lcData.submissionCalendar || '{}');
    for (const [timestampStr, count] of Object.entries(calendar)) {
      const timestampMs = parseInt(timestampStr) * 1000;
      const dateStr = getLocalDateString(new Date(timestampMs));
      solvesByDate[dateStr] = (solvesByDate[dateStr] || 0) + count;
    }
  }

  // 2. Process Codeforces Cache
  let cfAllTime = 0;
  if (member.codeforces_username && member.cache?.codeforces?.status) {
    const cfStatus = member.cache.codeforces.status;
    
    // Deduplicate CF accepted submissions by problem id (contestId + index or name)
    const acceptedProblems = new Set();
    const cfSolvesTemp = {};

    cfStatus.forEach(sub => {
      if (sub.verdict === 'OK') {
        const probId = sub.problem.contestId && sub.problem.index 
          ? `${sub.problem.contestId}_${sub.problem.index}` 
          : sub.problem.name;
        
        if (!acceptedProblems.has(probId)) {
          acceptedProblems.add(probId);
          
          // Map solve day
          const dateStr = getLocalDateString(new Date(sub.creationTimeSeconds * 1000));
          cfSolvesTemp[dateStr] = (cfSolvesTemp[dateStr] || 0) + 1;
        }
      }
    });

    cfAllTime = acceptedProblems.size;

    // Merge CF solves into the unified registry
    for (const [dateStr, count] of Object.entries(cfSolvesTemp)) {
      solvesByDate[dateStr] = (solvesByDate[dateStr] || 0) + count;
    }
  }

  // 3. Process Manual Logs
  const memberManualLogs = allManualLogs.filter(log => log.member_id === member.member_id);
  const manualAllTime = memberManualLogs.length;

  memberManualLogs.forEach(log => {
    const dateStr = log.solved_at;
    solvesByDate[dateStr] = (solvesByDate[dateStr] || 0) + 1;
  });

  // Calculate solves in different time windows
  const monday = getLastMonday();
  const startOfMonth = getStartOfMonth();

  let lcThisWeek = 0;
  let cfThisWeek = 0;
  let manualThisWeek = 0;

  let lcThisMonth = 0;
  let cfThisMonth = 0;
  let manualThisMonth = 0;

  // Recalculate platform-specific totals since last Monday
  if (member.leetcode_username && member.cache?.leetcode) {
    const calendar = JSON.parse(member.cache.leetcode.submissionCalendar || '{}');
    for (const [tStr, count] of Object.entries(calendar)) {
      const ms = parseInt(tStr) * 1000;
      const date = new Date(ms);
      if (date >= monday) lcThisWeek += count;
      if (date >= startOfMonth) lcThisMonth += count;
    }
  }

  if (member.codeforces_username && member.cache?.codeforces?.status) {
    const acceptedCf = new Set();
    member.cache.codeforces.status.forEach(sub => {
      if (sub.verdict === 'OK') {
        const probId = sub.problem.contestId && sub.problem.index 
          ? `${sub.problem.contestId}_${sub.problem.index}` 
          : sub.problem.name;
        
        if (!acceptedCf.has(probId)) {
          acceptedCf.add(probId);
          const date = new Date(sub.creationTimeSeconds * 1000);
          if (date >= monday) cfThisWeek += 1;
          if (date >= startOfMonth) cfThisMonth += 1;
        }
      }
    });
  }

  memberManualLogs.forEach(log => {
    const date = new Date(log.solved_at + 'T00:00:00');
    if (date >= monday) manualThisWeek += 1;
    if (date >= startOfMonth) manualThisMonth += 1;
  });

  const totalThisWeek = lcThisWeek + cfThisWeek + manualThisWeek;
  const totalThisMonth = lcThisMonth + cfThisMonth + manualThisMonth;
  const totalAllTime = lcAllTime + cfAllTime + manualAllTime;

  // Active stats
  const solvedToday = (solvesByDate[todayStr] || 0) > 0;
  const dailyGoalHit = (solvesByDate[todayStr] || 0) >= member.daily_goal;
  
  // Weekly goal progress
  const weeklyGoalProgress = totalThisWeek / member.weekly_goal;

  // Streak calculations
  const allSolvedDates = Object.keys(solvesByDate).filter(d => solvesByDate[d] > 0).sort();
  const currentStreak = computeCurrentStreak(allSolvedDates);
  const longestStreak = computeLongestStreak(allSolvedDates);

  // Last Active Date String
  let lastActiveText = 'Inactive';
  let lastActiveTimestamp = 0;
  if (allSolvedDates.length > 0) {
    const lastDateStr = allSolvedDates[allSolvedDates.length - 1];
    lastActiveText = lastDateStr;
    lastActiveTimestamp = new Date(lastDateStr + 'T00:00:00').getTime();
  }

  // 30-Day Attendance List
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
  
  const last30DaysList = getDaysInRange(thirtyDaysAgo, new Date());
  const attendance = last30DaysList.map(dateStr => {
    const count = solvesByDate[dateStr] || 0;
    return {
      date: dateStr,
      count: count,
      hit: count >= member.daily_goal
    };
  });

  // Calculate historical weekly hit rate from snapshots
  const snapshots = member.weekly_snapshots || [];
  const hitSnapshots = snapshots.filter(s => s.hit).length;
  const weeklyGoalHitRate = snapshots.length > 0 
    ? Math.round((hitSnapshots / snapshots.length) * 100) 
    : null; // Show dash if no history snapshots yet

  return {
    ...member,
    lc_this_week: lcThisWeek,
    lc_this_month: lcThisMonth,
    lc_all_time: lcAllTime,
    cf_this_week: cfThisWeek,
    cf_this_month: cfThisMonth,
    cf_all_time: cfAllTime,
    manual_this_week: manualThisWeek,
    manual_this_month: manualThisMonth,
    manual_all_time: manualAllTime,
    total_this_week: totalThisWeek,
    total_this_month: totalThisMonth,
    total_all_time: totalAllTime,
    solved_today: solvedToday,
    daily_goal_hit: dailyGoalHit,
    weekly_goal_progress: weeklyGoalProgress,
    weekly_goal_hit_rate: weeklyGoalHitRate,
    current_streak: currentStreak,
    longest_streak: longestStreak,
    last_active: lastActiveText,
    last_active_timestamp: lastActiveTimestamp,
    attendance: attendance,
    solves_by_date: solvesByDate
  };
};

// Compute current streak from sorted unique solve date strings
const computeCurrentStreak = (solvedDates) => {
  if (solvedDates.length === 0) return 0;
  
  const todayStr = getLocalDateString();
  const yesterdayStr = getLocalDateString(new Date(Date.now() - 86400000));
  
  const hasSolvedToday = solvedDates.includes(todayStr);
  const hasSolvedYesterday = solvedDates.includes(yesterdayStr);
  
  if (!hasSolvedToday && !hasSolvedYesterday) return 0;

  let streak = 0;
  let checkDate = hasSolvedToday ? new Date(todayStr + 'T00:00:00') : new Date(yesterdayStr + 'T00:00:00');

  while (true) {
    const checkStr = getLocalDateString(checkDate);
    if (solvedDates.includes(checkStr)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1); // Check previous day
    } else {
      break;
    }
  }
  return streak;
};

// Compute longest streak from sorted unique solve date strings
const computeLongestStreak = (solvedDates) => {
  if (solvedDates.length === 0) return 0;
  
  let longest = 0;
  let current = 0;
  let prevTimestamp = null;

  solvedDates.forEach(dateStr => {
    const currentTimestamp = new Date(dateStr + 'T00:00:00').getTime();
    
    if (prevTimestamp === null) {
      current = 1;
    } else {
      const diffDays = Math.round((currentTimestamp - prevTimestamp) / 86400000);
      if (diffDays === 1) {
        current++;
      } else if (diffDays > 1) {
        longest = Math.max(longest, current);
        current = 1;
      }
    }
    prevTimestamp = currentTimestamp;
  });

  return Math.max(longest, current);
};

// --- WEEKLY SNAPSHOT / RESET logic ---
const checkWeeklyReset = (room) => {
  const currentMondayStr = getLocalDateString(getLastMonday());
  const lastReset = room.last_weekly_reset;

  if (!lastReset || lastReset < currentMondayStr) {
    // Determine the list of Mondays that passed
    let checkMonday = lastReset ? new Date(lastReset + 'T00:00:00') : new Date(room.created_at);
    checkMonday.setDate(checkMonday.getDate() - checkMonday.getDay() + 1); // Set to its starting Monday
    checkMonday.setHours(0, 0, 0, 0);

    const targetMondayTime = new Date(currentMondayStr + 'T00:00:00').getTime();
    
    // Proactively loop and record historical snapshots
    let updated = false;
    while (checkMonday.getTime() < targetMondayTime) {
      const weekStartStr = getLocalDateString(checkMonday);
      
      // Calculate end of that week (next Sunday/Monday start boundary)
      const nextWeekMonday = new Date(checkMonday);
      nextWeekMonday.setDate(nextWeekMonday.getDate() + 7);
      
      room.members.forEach(member => {
        if (!member.weekly_snapshots) member.weekly_snapshots = [];
        
        // Check if snapshot for this week already exists
        const exists = member.weekly_snapshots.find(s => s.week_start === weekStartStr);
        if (!exists) {
          const weeklySolves = calculateHistoricalWeeklySolves(member, room.manual_logs, checkMonday, nextWeekMonday);
          member.weekly_snapshots.push({
            week_start: weekStartStr,
            total_solved: weeklySolves,
            goal: member.weekly_goal,
            hit: weeklySolves >= member.weekly_goal
          });
          updated = true;
        }
      });
      
      checkMonday.setDate(checkMonday.getDate() + 7);
    }

    if (updated || !lastReset) {
      room.last_weekly_reset = currentMondayStr;
      
      // Save changes back to storage
      const rooms = getRoomsFromStorage();
      const idx = rooms.findIndex(r => r.room_id === room.room_id);
      rooms[idx] = room;
      saveRoomsToStorage(rooms);
      
      showToast('Weekly milestones reset. Archiving previous week stats.', 'success');
    }
  }
};

const calculateHistoricalWeeklySolves = (member, manualLogs, weekStartDate, weekEndDate) => {
  let lcCount = 0;
  let cfCount = 0;
  let manualCount = 0;

  // LeetCode
  if (member.leetcode_username && member.cache?.leetcode) {
    const calendar = JSON.parse(member.cache.leetcode.submissionCalendar || '{}');
    for (const [timestampStr, count] of Object.entries(calendar)) {
      const ms = parseInt(timestampStr) * 1000;
      const date = new Date(ms);
      if (date >= weekStartDate && date < weekEndDate) {
        lcCount += count;
      }
    }
  }

  // Codeforces
  if (member.codeforces_username && member.cache?.codeforces?.status) {
    const dedupedCf = new Set();
    member.cache.codeforces.status.forEach(sub => {
      if (sub.verdict === 'OK') {
        const probId = sub.problem.contestId && sub.problem.index ? `${sub.problem.contestId}_${sub.problem.index}` : sub.problem.name;
        if (!dedupedCf.has(probId)) {
          dedupedCf.add(probId);
          const date = new Date(sub.creationTimeSeconds * 1000);
          if (date >= weekStartDate && date < weekEndDate) {
            cfCount++;
          }
        }
      }
    });
  }

  // Manual logs
  const memberLogs = manualLogs.filter(log => log.member_id === member.member_id);
  memberLogs.forEach(log => {
    const date = new Date(log.solved_at + 'T00:00:00');
    if (date >= weekStartDate && date < weekEndDate) {
      manualCount++;
    }
  });

  return lcCount + cfCount + manualCount;
};

// --- DATA SYNC ENGINE (PARALLEL CAPPED FETCHES) ---
const syncActiveRoomData = async (force = false) => {
  const rooms = getRoomsFromStorage();
  const room = rooms.find(r => r.room_id === activeRoomId);
  if (!room) return;

  const syncBtn = document.querySelector('.room-header .btn-primary');
  if (syncBtn) {
    syncBtn.disabled = true;
    syncBtn.innerHTML = '⟳ Syncing...';
  }

  showToast('Starting room data synchronization...', 'info');

  const fetchPromises = room.members.map(async (member) => {
    // Only fetch if force is true, or if never fetched, or if last fetched was >24 hours ago
    const needsFetch = force || !member.cache || !member.cache.last_fetched || 
      (Date.now() - member.cache.last_fetched > 24 * 60 * 60 * 1000);
    
    if (!needsFetch) return; // Keep cached copy

    const memberUpdated = { ...member };
    if (!memberUpdated.cache) {
      memberUpdated.cache = { last_fetched: 0 };
    }

    let errorOccurred = false;

    // 1. Fetch LeetCode
    if (member.leetcode_username) {
      try {
        const res = await fetch(`/api/fetch?platform=leetcode&username=${member.leetcode_username}`);
        if (res.ok) {
          memberUpdated.cache.leetcode = await res.json();
          memberUpdated.leetcode_error = false;
        } else {
          errorOccurred = true;
          memberUpdated.leetcode_error = true;
        }
      } catch (err) {
        errorOccurred = true;
        memberUpdated.leetcode_error = true;
      }
    }

    // 2. Fetch Codeforces
    if (member.codeforces_username) {
      try {
        const res = await fetch(`/api/fetch?platform=codeforces&username=${member.codeforces_username}`);
        if (res.ok) {
          memberUpdated.cache.codeforces = await res.json();
          memberUpdated.codeforces_error = false;
        } else {
          errorOccurred = true;
          memberUpdated.codeforces_error = true;
        }
      } catch (err) {
        errorOccurred = true;
        memberUpdated.codeforces_error = true;
      }
    }

    // Update fetched date if at least one platform fetched or was bypassed
    if (!errorOccurred && (member.leetcode_username || member.codeforces_username)) {
      memberUpdated.cache.last_fetched = Date.now();
    }
    
    return memberUpdated;
  });

  try {
    const updatedMembersResults = await Promise.all(fetchPromises);
    
    // Map non-null values back into the room state
    updatedMembersResults.forEach((updatedMember, idx) => {
      if (updatedMember) {
        room.members[idx] = updatedMember;
      }
    });

    // Save changes
    const idx = rooms.findIndex(r => r.room_id === room.room_id);
    rooms[idx] = room;
    saveRoomsToStorage(rooms);

    // Refresh UI
    initRoomView(activeRoomId);
    showToast('Room successfully synchronized!', 'success');
  } catch (err) {
    showToast('Failed to sync room data. Check connection.', 'error');
  } finally {
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.innerHTML = '<span class="btn-icon">⟳</span> Sync Data';
    }
  }
};

// Daily Flush Logic: Auto sync stale members on app load
const triggerDailyFlushSync = (room) => {
  const staleMembers = room.members.filter(m => {
    if (!m.leetcode_username && !m.codeforces_username) return false;
    if (!m.cache || !m.cache.last_fetched) return true;
    return (Date.now() - m.cache.last_fetched > 24 * 60 * 60 * 1000);
  });

  if (staleMembers.length > 0) {
    showToast(`${staleMembers.length} member statistics are stale. Auto synchronizing...`, 'info');
    syncActiveRoomData(false);
  }
};

// --- UI RENDERING HANDLERS ---

// Render combined leaderboard
const renderLeaderboard = () => {
  const tbody = document.getElementById('leaderboard-body');
  tbody.innerHTML = '';

  let sorted = [...window.computedRoomMembers];

  // Apply sorting logic
  sorted.sort((a, b) => {
    let valA, valB;
    if (currentSortColumn === 'rank' || currentSortColumn === 'this_week') {
      valA = a.total_this_week;
      valB = b.total_this_week;
    } else if (currentSortColumn === 'name') {
      valA = a.display_name.toLowerCase();
      valB = b.display_name.toLowerCase();
    } else if (currentSortColumn === 'this_month') {
      valA = a.total_this_month;
      valB = b.total_this_month;
    } else if (currentSortColumn === 'all_time') {
      valA = a.total_all_time;
      valB = b.total_all_time;
    } else if (currentSortColumn === 'goal_pct') {
      valA = a.weekly_goal_progress;
      valB = b.weekly_goal_progress;
    } else if (currentSortColumn === 'streak') {
      valA = a.current_streak;
      valB = b.current_streak;
    } else if (currentSortColumn === 'last_active') {
      valA = a.last_active_timestamp;
      valB = b.last_active_timestamp;
    }

    if (valA < valB) return currentSortDirection === 'asc' ? -1 : 1;
    if (valA > valB) return currentSortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  // Highlight headers
  document.querySelectorAll('#main-leaderboard th').forEach(th => {
    const colName = th.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
    const indicator = th.querySelector('.sort-indicator');
    if (indicator) {
      if (colName === currentSortColumn) {
        indicator.innerText = currentSortDirection === 'asc' ? '▲' : '▼';
      } else {
        indicator.innerText = '';
      }
    }
  });

  sorted.forEach((member, index) => {
    const tr = document.createElement('tr');
    
    // Classes for self and inactive rows
    let classes = [];
    if (member.is_self) classes.push('row-self');
    
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    if (member.last_active_timestamp > 0 && member.last_active_timestamp < sevenDaysAgo) {
      classes.push('row-inactive');
    }
    tr.className = classes.join(' ');

    // Calculate Rank
    let rank = index + 1;
    if (currentSortColumn === 'this_week' && currentSortDirection === 'desc') {
      // Keep natural rank
    } else {
      // Determine rank based on sorted order or hide
    }

    // Has errors / stale states
    const isStale = member.leetcode_error || member.codeforces_error;
    const staleTag = isStale ? `<span class="stale-badge" title="API sync failed. Cached stats shown.">Stale</span>` : '';

    // Goal progress percentage and cap for bar
    const progressPct = Math.round(member.weekly_goal_progress * 100);
    const progressCap = Math.min(progressPct, 100);
    const barClass = progressPct >= 100 ? 'goal-fill-complete' : 'goal-fill-normal';

    tr.innerHTML = `
      <td class="rank-val">#${rank}</td>
      <td class="text-left">
        <div class="name-cell">
          ${member.solved_today ? '<span class="active-dot" title="Solved today!"></span>' : ''}
          <strong>${member.display_name}</strong>
          ${member.is_self ? '<span class="optional">(You)</span>' : ''}
          ${staleTag}
        </div>
      </td>
      <td>
        <strong>${member.total_this_week}</strong>
        <span class="solved-breakdown-sub">${member.lc_this_week} LC · ${member.cf_this_week} CF · ${member.manual_this_week} manual</span>
      </td>
      <td>
        <strong>${member.total_this_month}</strong>
        <span class="solved-breakdown-sub">${member.lc_this_month} LC · ${member.cf_this_month} CF · ${member.manual_this_month} manual</span>
      </td>
      <td>
        <strong>${member.total_all_time}</strong>
        <span class="solved-breakdown-sub">${member.lc_all_time} LC · ${member.cf_all_time} CF · ${member.manual_all_time} manual</span>
      </td>
      <td>
        <div class="goal-progress-bar-container">
          <div class="progress-bar-bg">
            <div class="progress-bar-fill ${barClass}" style="width: ${progressCap}%"></div>
          </div>
          <span class="progress-val-text">${progressPct}%</span>
        </div>
      </td>
      <td>
        ${member.current_streak > 0 
          ? `<span class="streak-badge" title="Longest streak: ${member.longest_streak} days">🔥 ${member.current_streak}</span>` 
          : `<span class="text-muted">${member.current_streak}</span>`}
      </td>
      <td>
        <span class="last-active-date-val">${member.last_active}</span>
      </td>
    `;
    tbody.appendChild(tr);
  });
};

const sortLeaderboard = (col) => {
  if (currentSortColumn === col) {
    currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    currentSortColumn = col;
    currentSortDirection = 'desc'; // Default desc
  }
  renderLeaderboard();
};

// Render platform breakdowns
const renderPlatformBreakdowns = () => {
  // LeetCode
  const lcBody = document.getElementById('leetcode-breakdown-body');
  lcBody.innerHTML = '';
  window.computedRoomMembers.forEach(member => {
    const tr = document.createElement('tr');
    if (member.leetcode_username) {
      let easy = 0, medium = 0, hard = 0;
      if (member.cache?.leetcode?.submitStats?.acSubmissionNum) {
        const stats = member.cache.leetcode.submitStats.acSubmissionNum;
        easy = stats.find(s => s.difficulty === 'Easy')?.count || 0;
        medium = stats.find(s => s.difficulty === 'Medium')?.count || 0;
        hard = stats.find(s => s.difficulty === 'Hard')?.count || 0;
      }
      
      tr.innerHTML = `
        <td class="text-left"><strong>${member.display_name}</strong></td>
        <td><code>${member.leetcode_username}</code></td>
        <td><strong>${member.lc_this_week}</strong></td>
        <td>${member.lc_this_month}</td>
        <td>${member.lc_all_time}</td>
        <td><span class="optional">${easy} E · ${medium} M · ${hard} H</span></td>
      `;
    } else {
      tr.innerHTML = `
        <td class="text-left text-muted"><strong>${member.display_name}</strong></td>
        <td class="text-muted">—</td>
        <td class="text-muted">—</td>
        <td class="text-muted">—</td>
        <td class="text-muted">—</td>
        <td class="text-muted">—</td>
      `;
    }
    lcBody.appendChild(tr);
  });

  // Codeforces
  const cfBody = document.getElementById('codeforces-breakdown-body');
  cfBody.innerHTML = '';
  window.computedRoomMembers.forEach(member => {
    const tr = document.createElement('tr');
    if (member.codeforces_username) {
      let rating = 'Unrated';
      if (member.cache?.codeforces?.info?.rating) {
        rating = `${member.cache.codeforces.info.rating} (${member.cache.codeforces.info.rank})`;
      }
      
      tr.innerHTML = `
        <td class="text-left"><strong>${member.display_name}</strong></td>
        <td><code>${member.codeforces_username}</code></td>
        <td><strong>${member.cf_this_week}</strong></td>
        <td>${member.cf_this_month}</td>
        <td>${member.cf_all_time}</td>
        <td><span class="optional">${rating}</span></td>
      `;
    } else {
      tr.innerHTML = `
        <td class="text-left text-muted"><strong>${member.display_name}</strong></td>
        <td class="text-muted">—</td>
        <td class="text-muted">—</td>
        <td class="text-muted">—</td>
        <td class="text-muted">—</td>
        <td class="text-muted">—</td>
      `;
    }
    cfBody.appendChild(tr);
  });
};

// Render 30-Day Heatmap Grid
const renderAttendanceGrid = () => {
  const container = document.getElementById('attendance-heatmap-container');
  container.innerHTML = '';

  window.computedRoomMembers.forEach(member => {
    const row = document.createElement('div');
    row.className = 'member-heatmap-row';
    
    // Label
    const label = document.createElement('div');
    label.className = 'heatmap-label';
    label.innerText = member.display_name;
    row.appendChild(label);

    // Cells Grid
    const cellsGrid = document.createElement('div');
    cellsGrid.className = 'heatmap-cells-grid';

    member.attendance.forEach(day => {
      const cell = document.createElement('div');
      cell.className = 'heatmap-cell';
      
      if (day.count > 0) {
        if (day.hit) {
          cell.classList.add('status-goal-hit');
        } else {
          cell.classList.add('status-solved');
        }
      }

      // Add tooltip
      cell.setAttribute('data-tooltip', `${day.date}: ${day.count} solved`);
      cellsGrid.appendChild(cell);
    });

    row.appendChild(cellsGrid);
    container.appendChild(row);
  });

  // Add Axis Labels (Start dates, End dates / Today)
  const axis = document.createElement('div');
  axis.className = 'heatmap-axis-labels';
  
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
  
  axis.innerHTML = `
    <span>${getLocalDateString(thirtyDaysAgo)}</span>
    <span>Today (${getLocalDateString()})</span>
  `;
  container.appendChild(axis);
};

// Render progress cards in goals panel
const renderGoalsPanel = () => {
  const container = document.getElementById('goals-container');
  container.innerHTML = '';

  // Sort: active self member always first
  const list = [...window.computedRoomMembers].sort((a, b) => {
    if (a.is_self) return -1;
    if (b.is_self) return 1;
    return 0;
  });

  list.forEach(member => {
    const card = document.createElement('div');
    card.className = `goal-card ${member.is_self ? 'card-is-self' : ''}`;

    const progressPct = Math.round(member.weekly_goal_progress * 100);
    const progressCap = Math.min(progressPct, 100);
    const barClass = progressPct >= 100 ? 'goal-fill-complete' : 'goal-fill-normal';

    const hitRateText = member.weekly_goal_hit_rate !== null 
      ? `${member.weekly_goal_hit_rate}%` 
      : '—';

    card.innerHTML = `
      <div class="goal-card-header">
        <div class="goal-member-name">
          <strong>${member.display_name}</strong>
          ${member.is_self ? '<span>(You)</span>' : ''}
        </div>
        <div class="goal-specs-badge">
          Goal: ${member.daily_goal}/day · ${member.weekly_goal}/week
        </div>
      </div>
      <div class="goal-progress-detail">
        <div class="goal-bar-label">
          <span>Weekly Solves: <strong>${member.total_this_week}</strong></span>
          <span>${progressPct}%</span>
        </div>
        <div class="goal-bar-bg">
          <div class="goal-bar-fill ${barClass}" style="width: ${progressCap}%"></div>
        </div>
        <div class="goal-history-hitrate">
          <span>Historical Hit Rate</span>
          <span class="hitrate-val">${hitRateText}</span>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
};

// Render Room Stats (metric cards)
const renderRoomStatsPanel = () => {
  const members = window.computedRoomMembers;
  if (members.length === 0) return;

  // 1. Current Leader
  const sortedByWeek = [...members].sort((a,b) => b.total_this_week - a.total_this_week);
  const leader = sortedByWeek[0];
  if (leader && leader.total_this_week > 0) {
    document.getElementById('stat-leader-val').innerText = leader.display_name;
    document.getElementById('stat-leader-desc').innerText = `${leader.total_this_week} solved this week`;
  } else {
    document.getElementById('stat-leader-val').innerText = '—';
    document.getElementById('stat-leader-desc').innerText = 'No solves logged this week';
  }

  // 2. Most Consistent (Highest hit rate)
  const consistentList = members.filter(m => m.weekly_goal_hit_rate !== null);
  if (consistentList.length > 0) {
    const sortedConsistent = consistentList.sort((a,b) => b.weekly_goal_hit_rate - a.weekly_goal_hit_rate);
    const mostConsistent = sortedConsistent[0];
    document.getElementById('stat-consistent-val').innerText = mostConsistent.display_name;
    document.getElementById('stat-consistent-desc').innerText = `${mostConsistent.weekly_goal_hit_rate}% weekly goal hit rate`;
  } else {
    document.getElementById('stat-consistent-val').innerText = '—';
    document.getElementById('stat-consistent-desc').innerText = 'No history snapshots recorded';
  }

  // 3. Longest Streak
  const sortedByStreak = [...members].sort((a,b) => b.current_streak - a.current_streak);
  const longestStreakMember = sortedByStreak[0];
  if (longestStreakMember && longestStreakMember.current_streak > 0) {
    document.getElementById('stat-streak-val').innerText = longestStreakMember.display_name;
    document.getElementById('stat-streak-desc').innerText = `${longestStreakMember.current_streak} days active streak`;
  } else {
    document.getElementById('stat-streak-val').innerText = '—';
    document.getElementById('stat-streak-desc').innerText = 'No active streaks';
  }

  // 4. Biggest Gap Closed
  // Compute gap closed algorithm
  const gapClosedWinner = computeBiggestGapClosed(members);
  if (gapClosedWinner) {
    document.getElementById('stat-gap-val').innerText = gapClosedWinner.name;
    document.getElementById('stat-gap-desc').innerText = `Closed the gap by ${gapClosedWinner.gained} problems`;
  } else {
    document.getElementById('stat-gap-val').innerText = '—';
    document.getElementById('stat-gap-desc').innerText = 'No catch-ups this week';
  }
};

// Mathematically elegant "Gap Closed" algorithm
const computeBiggestGapClosed = (members) => {
  if (members.length < 2) return null;

  // Let's analyze days of the current week (from Monday to today)
  const monday = getLastMonday();
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  
  const daysOfWeek = getDaysInRange(monday, today);
  
  // Calculate leader on week's scoreboard today
  const currentLeader = [...members].sort((a,b) => b.total_this_week - a.total_this_week)[0];
  if (!currentLeader || currentLeader.total_this_week === 0) return null;

  const gapGains = [];

  members.forEach(member => {
    // Skip current leader
    if (member.member_id === currentLeader.member_id) return;

    let maxGap = 0;
    
    // We calculate cumulative gap for each day of the week
    let cumulativeLeader = 0;
    let cumulativeMember = 0;

    daysOfWeek.forEach(dateStr => {
      const leaderDaySolves = currentLeader.solves_by_date[dateStr] || 0;
      const memberDaySolves = member.solves_by_date[dateStr] || 0;

      cumulativeLeader += leaderDaySolves;
      cumulativeMember += memberDaySolves;

      const gap = cumulativeLeader - cumulativeMember;
      if (gap > maxGap) {
        maxGap = gap;
      }
    });

    const currentGap = currentLeader.total_this_week - member.total_this_week;
    const gained = maxGap - currentGap;

    if (gained > 0) {
      gapGains.push({
        name: member.display_name,
        gained: gained
      });
    }
  });

  if (gapGains.length === 0) return null;
  
  // Return member with highest gained solves
  gapGains.sort((a,b) => b.gained - a.gained);
  return gapGains[0];
};

// Render your manual logs list (collapsible subpanel)
const renderManualLogsList = () => {
  const container = document.getElementById('manual-logs-list');
  container.innerHTML = '';

  const logs = window.currentRoomManualLogs || [];
  if (logs.length === 0) {
    container.innerHTML = '<div class="no-logs-text">No manual solves logged yet.</div>';
    return;
  }

  // Sort logs in reverse chronological order
  const sorted = [...logs].sort((a, b) => new Date(b.solved_at) - new Date(a.solved_at));

  sorted.forEach(log => {
    const item = document.createElement('div');
    item.className = 'log-item';
    
    const urlHtml = log.problem_url 
      ? `<a href="${log.problem_url}" target="_blank" class="log-title-text">${log.problem_name || 'Solve Entry'} ↗</a>`
      : `<span class="log-title-text">${log.problem_name || 'Solve Entry'}</span>`;

    item.innerHTML = `
      <div class="log-item-left">
        <div class="log-title-row">
          ${urlHtml}
          <span class="log-platform-tag">${log.platform}</span>
        </div>
        <span class="log-meta-text">Solved: ${log.solved_at}</span>
      </div>
      <button class="log-item-delete-btn" onclick="deleteManualLog('${log.log_id}')" title="Delete entry">🗑️</button>
    `;
    container.appendChild(item);
  });
};

// --- MANUAL LOGS OPERATIONS ---
const deleteManualLog = async (logId) => {
  if (!confirm('Are you sure you want to delete this log?')) return;

  try {
    const res = await fetch('/api/room/delete-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: activeRoomId, log_id: logId })
    });
    
    if (res.ok) {
      const serverRoom = await res.json();
      const rooms = getRoomsFromStorage();
      const idx = rooms.findIndex(r => r.room_id === activeRoomId);
      if (idx !== -1) {
        // Keep local caches
        const mergedMembers = serverRoom.members.map(sM => {
          const lM = rooms[idx].members.find(m => m.member_id === sM.member_id);
          return { ...sM, cache: lM?.cache || { last_fetched: 0 } };
        });
        rooms[idx] = { ...serverRoom, members: mergedMembers };
        saveRoomsToStorage(rooms);
      }
      showToast('Log successfully deleted!', 'success');
      initRoomView(activeRoomId);
    } else {
      const data = await res.json();
      showToast(data.error || 'Failed to delete log from server.', 'error');
    }
  } catch (err) {
    showToast('Network error deleting log.', 'error');
  }
};

// --- NAVIGATION & FORM SUBMISSION HANDLING ---

// Toggle tabs in Landing View
const switchLandingTab = (tab) => {
  const createBtn = document.getElementById('tab-create-btn');
  const joinBtn = document.getElementById('tab-join-btn');
  const createForm = document.getElementById('create-room-form');
  const joinForm = document.getElementById('join-room-form');

  if (tab === 'create') {
    createBtn.classList.add('active');
    joinBtn.classList.remove('active');
    createForm.classList.add('active');
    joinForm.classList.remove('active');
  } else {
    createBtn.classList.remove('active');
    joinBtn.classList.add('active');
    createForm.classList.remove('active');
    joinForm.classList.add('active');
  }
};

// Validate username exists on platform
const validateUsername = async (platform, username) => {
  try {
    const res = await fetch(`/api/fetch?platform=${platform}&username=${username}`);
    return res.ok;
  } catch (err) {
    return false;
  }
};

// Form: CREATE ROOM
const handleCreateRoom = async (event) => {
  event.preventDefault();
  
  const roomName = document.getElementById('create-room-name').value.trim();
  const displayName = document.getElementById('create-display-name').value.trim();
  const leetcode = document.getElementById('create-leetcode').value.trim();
  const codeforces = document.getElementById('create-codeforces').value.trim();
  const dailyGoal = parseInt(document.getElementById('create-daily-goal').value);
  const weeklyGoal = parseInt(document.getElementById('create-weekly-goal').value);

  const loader = document.querySelector('#btn-create-submit .btn-loader');
  const btnText = document.querySelector('#btn-create-submit .btn-text');

  if (!leetcode && !codeforces) {
    showToast('Provide at least one LeetCode or Codeforces username.', 'warning');
    return;
  }

  loader.classList.remove('hidden');
  btnText.innerText = 'Checking usernames...';

  // Validate Usernames
  if (leetcode) {
    const valid = await validateUsername('leetcode', leetcode);
    if (!valid) {
      showToast(`LeetCode username '${leetcode}' not found. Check and try again.`, 'error');
      loader.classList.add('hidden');
      btnText.innerText = 'Generate Room';
      return;
    }
  }

  if (codeforces) {
    const valid = await validateUsername('codeforces', codeforces);
    if (!valid) {
      showToast(`Codeforces handle '${codeforces}' not found. Check and try again.`, 'error');
      loader.classList.add('hidden');
      btnText.innerText = 'Generate Room';
      return;
    }
  }

  // Create room object
  const newMember = {
    member_id: generateId(),
    display_name: displayName,
    leetcode_username: leetcode,
    codeforces_username: codeforces,
    daily_goal: dailyGoal,
    weekly_goal: weeklyGoal,
    is_self: true,
    weekly_snapshots: [],
    cache: { last_fetched: 0 }
  };

  try {
    const res = await fetch('/api/room/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_name: roomName || 'Placement Prep', member: newMember })
    });

    if (res.ok) {
      const serverRoom = await res.json();
      const rooms = getRoomsFromStorage();
      rooms.push(serverRoom);
      saveRoomsToStorage(rooms);

      loader.classList.add('hidden');
      btnText.innerText = 'Generate Room';
      
      showToast('Room successfully generated!', 'success');
      navigateToRoom(serverRoom.room_id);
    } else {
      const data = await res.json();
      showToast(data.error || 'Failed to create room on server.', 'error');
      loader.classList.add('hidden');
      btnText.innerText = 'Generate Room';
    }
  } catch (err) {
    showToast('Network error creating room.', 'error');
    loader.classList.add('hidden');
    btnText.innerText = 'Generate Room';
  }
};

// Form: JOIN ROOM
const handleJoinRoom = async (event) => {
  event.preventDefault();

  const code = document.getElementById('join-room-code').value.trim().toUpperCase();
  const displayName = document.getElementById('join-display-name').value.trim();
  const leetcode = document.getElementById('join-leetcode').value.trim();
  const codeforces = document.getElementById('join-codeforces').value.trim();
  const dailyGoal = parseInt(document.getElementById('join-daily-goal').value);
  const weeklyGoal = parseInt(document.getElementById('join-weekly-goal').value);

  const loader = document.querySelector('#btn-join-submit .btn-loader');
  const btnText = document.querySelector('#btn-join-submit .btn-text');

  if (!leetcode && !codeforces) {
    showToast('Provide at least one LeetCode or Codeforces username.', 'warning');
    return;
  }

  loader.classList.remove('hidden');
  btnText.innerText = 'Checking usernames...';

  // Validate
  if (leetcode) {
    const valid = await validateUsername('leetcode', leetcode);
    if (!valid) {
      showToast(`LeetCode username '${leetcode}' not found. Check and try again.`, 'error');
      loader.classList.add('hidden');
      btnText.innerText = 'Join Room';
      return;
    }
  }

  if (codeforces) {
    const valid = await validateUsername('codeforces', codeforces);
    if (!valid) {
      showToast(`Codeforces handle '${codeforces}' not found. Check and try again.`, 'error');
      loader.classList.add('hidden');
      btnText.innerText = 'Join Room';
      return;
    }
  }

  const rooms = getRoomsFromStorage();
  let localRoom = rooms.find(r => r.room_id === code);
  let prefilledMembers = [];

  if (!localRoom) {
    const shared = window.sharedRoomData;
    if (shared && shared.code === code) {
      if (shared.members) {
        shared.members.split('|').forEach(p => {
          const [mName, mLc, mCf] = p.split(',');
          if (mName) {
            prefilledMembers.push({
              member_id: generateId(),
              display_name: decodeURIComponent(mName),
              leetcode_username: mLc !== 'null' ? mLc : '',
              codeforces_username: mCf !== 'null' ? mCf : '',
              daily_goal: 1,
              weekly_goal: 5,
              is_self: false,
              weekly_snapshots: [],
              cache: { last_fetched: 0 }
            });
          }
        });
      }
    }
  }

  // Create join member details
  const newMember = {
    member_id: generateId(),
    display_name: displayName,
    leetcode_username: leetcode,
    codeforces_username: codeforces,
    daily_goal: dailyGoal,
    weekly_goal: weeklyGoal,
    is_self: true,
    weekly_snapshots: [],
    cache: { last_fetched: 0 }
  };

  try {
    const res = await fetch('/api/room/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: code, member: newMember })
    });

    if (res.ok) {
      const serverRoom = await res.json();
      
      // Merge keeping caches
      const mergedMembers = serverRoom.members.map(sM => {
        const lM = localRoom?.members.find(m => m.member_id === sM.member_id) || 
                   prefilledMembers.find(m => m.display_name === sM.display_name);
        return {
          ...sM,
          cache: lM?.cache || { last_fetched: 0 },
          is_self: sM.display_name === displayName ? true : (lM?.is_self || false)
        };
      });

      const updatedRoom = { ...serverRoom, members: mergedMembers };
      const idx = rooms.findIndex(r => r.room_id === code);
      if (idx !== -1) {
        rooms[idx] = updatedRoom;
      } else {
        rooms.push(updatedRoom);
      }
      saveRoomsToStorage(rooms);

      window.sharedRoomData = null;
      document.getElementById('join-prefill-indicator').classList.add('hidden');

      loader.classList.add('hidden');
      btnText.innerText = 'Join Room';

      showToast(`Successfully joined room '${updatedRoom.room_name}'!`, 'success');
      navigateToRoom(code);
    } else {
      const data = await res.json();
      showToast(data.error || 'Failed to join room on server.', 'error');
      loader.classList.add('hidden');
      btnText.innerText = 'Join Room';
    }
  } catch (err) {
    showToast('Network error joining room.', 'error');
    loader.classList.add('hidden');
    btnText.innerText = 'Join Room';
  }
};

// Form: ADD MEMBER (Inside Room dashboard)
const handleAddMember = async (event) => {
  event.preventDefault();

  const displayName = document.getElementById('add-display-name').value.trim();
  const leetcode = document.getElementById('add-leetcode').value.trim();
  const codeforces = document.getElementById('add-codeforces').value.trim();
  const dailyGoal = parseInt(document.getElementById('add-daily-goal').value);
  const weeklyGoal = parseInt(document.getElementById('add-weekly-goal').value);

  const loader = document.querySelector('#btn-add-member-submit .btn-loader');
  const btnText = document.querySelector('#btn-add-member-submit .btn-text');

  if (!leetcode && !codeforces) {
    showToast('Provide at least one LeetCode or Codeforces username.', 'warning');
    return;
  }

  loader.classList.remove('hidden');
  btnText.innerText = 'Checking username...';

  // Validate
  if (leetcode) {
    const valid = await validateUsername('leetcode', leetcode);
    if (!valid) {
      showToast(`LeetCode username '${leetcode}' not found. Check and try again.`, 'error');
      loader.classList.add('hidden');
      btnText.innerText = 'Add Member';
      return;
    }
  }

  if (codeforces) {
    const valid = await validateUsername('codeforces', codeforces);
    if (!valid) {
      showToast(`Codeforces handle '${codeforces}' not found. Check and try again.`, 'error');
      loader.classList.add('hidden');
      btnText.innerText = 'Add Member';
      return;
    }
  }

  const rooms = getRoomsFromStorage();
  const localRoom = rooms.find(r => r.room_id === activeRoomId);
  if (!localRoom) return;

  const newMember = {
    member_id: generateId(),
    display_name: displayName,
    leetcode_username: leetcode,
    codeforces_username: codeforces,
    daily_goal: dailyGoal,
    weekly_goal: weeklyGoal,
    is_self: false,
    weekly_snapshots: [],
    cache: { last_fetched: 0 }
  };

  try {
    const res = await fetch('/api/room/add-member', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: activeRoomId, member: newMember })
    });

    if (res.ok) {
      const serverRoom = await res.json();
      
      // Merge keeping caches
      const mergedMembers = serverRoom.members.map(sM => {
        const lM = localRoom.members.find(m => m.member_id === sM.member_id);
        return {
          ...sM,
          cache: lM?.cache || { last_fetched: 0 },
          is_self: lM?.is_self || false
        };
      });

      const updatedRoom = { ...serverRoom, members: mergedMembers };
      const idx = rooms.findIndex(r => r.room_id === activeRoomId);
      rooms[idx] = updatedRoom;
      saveRoomsToStorage(rooms);

      loader.classList.add('hidden');
      btnText.innerText = 'Add Member';
      
      closeAddMemberModal();
      document.getElementById('add-member-form').reset();
      
      showToast(`${displayName} added! Syncing details...`, 'success');
      
      initRoomView(activeRoomId);
      syncActiveRoomData(true);
    } else {
      const data = await res.json();
      showToast(data.error || 'Failed to add member on server.', 'error');
      loader.classList.add('hidden');
      btnText.innerText = 'Add Member';
    }
  } catch (err) {
    showToast('Network error adding member.', 'error');
    loader.classList.add('hidden');
    btnText.innerText = 'Add Member';
  }
};

// Form: MANUAL LOG PROBLEM SOLVE
const handleManualLog = async (event) => {
  event.preventDefault();

  const platformSelect = document.getElementById('log-platform').value;
  const customPlatform = document.getElementById('log-custom-platform').value.trim();
  const problemName = document.getElementById('log-problem-name').value.trim();
  const problemUrl = document.getElementById('log-problem-url').value.trim();
  const solvedAt = document.getElementById('log-date').value;

  const platform = platformSelect === 'Other' ? (customPlatform || 'Other') : platformSelect;

  const rooms = getRoomsFromStorage();
  const localRoom = rooms.find(r => r.room_id === activeRoomId);
  if (!localRoom) return;

  const selfId = getSelfId(localRoom);
  if (!selfId) {
    showToast('Failed to identify active user in this room.', 'error');
    return;
  }

  const newLog = {
    log_id: generateId(),
    member_id: selfId,
    platform: platform,
    problem_name: problemName || 'Unspecified Problem',
    problem_url: problemUrl || '',
    solved_at: solvedAt
  };

  try {
    const res = await fetch('/api/room/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: activeRoomId, log: newLog })
    });

    if (res.ok) {
      const serverRoom = await res.json();
      
      // Merge keeping caches
      const mergedMembers = serverRoom.members.map(sM => {
        const lM = localRoom.members.find(m => m.member_id === sM.member_id);
        return {
          ...sM,
          cache: lM?.cache || { last_fetched: 0 },
          is_self: lM?.is_self || false
        };
      });

      const updatedRoom = { ...serverRoom, members: mergedMembers };
      const idx = rooms.findIndex(r => r.room_id === activeRoomId);
      rooms[idx] = updatedRoom;
      saveRoomsToStorage(rooms);

      closeManualLogModal();
      document.getElementById('manual-log-form').reset();
      
      showToast('Problem solve logged successfully!', 'success');
      initRoomView(activeRoomId);
    } else {
      const data = await res.json();
      showToast(data.error || 'Failed to log problem on server.', 'error');
    }
  } catch (err) {
    showToast('Network error logging problem.', 'error');
  }
};

// --- MODAL TRIGGERS ---
const openAddMemberModal = () => {
  document.getElementById('add-member-modal').classList.add('active');
};
const closeAddMemberModal = () => {
  document.getElementById('add-member-modal').classList.remove('active');
};

const openManualLogModal = () => {
  // Set date default value to today in local timezone
  document.getElementById('log-date').value = getLocalDateString();
  document.getElementById('manual-log-modal').classList.add('active');
};
const closeManualLogModal = () => {
  document.getElementById('manual-log-modal').classList.remove('active');
  document.getElementById('custom-platform-group').classList.add('hidden');
};

const toggleCustomPlatformInput = (val) => {
  const group = document.getElementById('custom-platform-group');
  if (val === 'Other') {
    group.classList.remove('hidden');
    document.getElementById('log-custom-platform').required = true;
  } else {
    group.classList.add('hidden');
    document.getElementById('log-custom-platform').required = false;
  }
};

// --- COPY METADATA AND LINK OPERATIONS ---
const copyRoomCode = () => {
  navigator.clipboard.writeText(activeRoomId).then(() => {
    showToast('Room Code copied to clipboard!', 'success');
  }).catch(() => {
    showToast('Failed to copy to clipboard.', 'error');
  });
};

const copyJoinLink = () => {
  const rooms = getRoomsFromStorage();
  const room = rooms.find(r => r.room_id === activeRoomId);
  if (!room) return;

  // Build members list payload
  const memberPayload = room.members
    .map(m => `${encodeURIComponent(m.display_name)},${m.leetcode_username || 'null'},${m.codeforces_username || 'null'}`)
    .join('|');

  const origin = window.location.origin;
  const link = `${origin}/room/${room.room_id}?name=${encodeURIComponent(room.room_name)}&members=${memberPayload}`;

  navigator.clipboard.writeText(link).then(() => {
    showToast('Shareable Join Link copied to clipboard!', 'success');
  }).catch(() => {
    showToast('Failed to copy share link.', 'error');
  });
};

// --- INITIAL ONLOAD TRIGGERS ---
window.addEventListener('DOMContentLoaded', () => {
  handleRouting();
  
  // If not in a room, render the saved rooms list on landing page
  if (!activeRoomId) {
    renderSavedRoomsList();
  }

  // Start polling for real-time multiplayer syncing
  setInterval(async () => {
    if (activeRoomId && document.visibilityState === 'visible') {
      try {
        const res = await fetch(`/api/room?id=${activeRoomId}`);
        if (res.ok) {
          const serverRoom = await res.json();
          const rooms = getRoomsFromStorage();
          const localIdx = rooms.findIndex(r => r.room_id === activeRoomId);
          if (localIdx !== -1) {
            const localRoom = rooms[localIdx];
            
            // Check if there are updates (members list or logs modified)
            const hasUpdates = localRoom.members.length !== serverRoom.members.length ||
              (localRoom.manual_logs || []).length !== (serverRoom.manual_logs || []).length ||
              JSON.stringify(localRoom.members.map(m => m.display_name)) !== 
              JSON.stringify(serverRoom.members.map(m => m.display_name));

            if (hasUpdates) {
              // Merge server data with local cache
              const mergedMembers = serverRoom.members.map(sM => {
                const lM = localRoom.members.find(m => m.member_id === sM.member_id);
                return {
                  ...sM,
                  cache: lM?.cache || { last_fetched: 0 },
                  is_self: lM ? lM.is_self : false
                };
              });

              rooms[localIdx] = {
                ...serverRoom,
                members: mergedMembers
              };
              saveRoomsToStorage(rooms);
              
              // Re-render UI with latest synced state
              initRoomView(activeRoomId);
            }
          }
        }
      } catch (err) {
        // Silent catch on poll failure
      }
    }
  }, 8000); // 8-second polling interval
});

window.addEventListener('popstate', () => {
  handleRouting();
});

// Re-fetch stale data every time page gains focus
window.addEventListener('focus', () => {
  if (activeRoomId) {
    const rooms = getRoomsFromStorage();
    const room = rooms.find(r => r.room_id === activeRoomId);
    if (room) {
      triggerDailyFlushSync(room);
    }
  }
});

// Real-time synchronization across multiple tabs in the same browser
window.addEventListener('storage', (e) => {
  if (e.key === 'rival_rooms') {
    if (activeRoomId) {
      initRoomView(activeRoomId);
    } else {
      renderSavedRoomsList();
    }
  }
});

