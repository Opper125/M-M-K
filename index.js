/* ======================================
   MY MMK - User Dashboard JavaScript
   COMPLETE FIXED VERSION
   ====================================== */

const SUPABASE_URL = 'https://qmeeqwdnjlmhjuexldsu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtZWVxd2RuamxtaGp1ZXhsZHN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4Mzg3MDYsImV4cCI6MjA3NTQxNDcwNn0.tyL8-OQByO7MALrBJCZ6rNZ0oR10DWSJ3776nHBgn7Q';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Global State
let currentUser = null;
let userIP = null;
let miningIntervals = [];
let activePlanSession = null;
let activeFreeSession = null;

// ======================================
// UTILITY FUNCTIONS
// ======================================

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast show ${type}`;
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    }).format(amount);
}

function formatDate(dateString) {
    const options = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    return new Date(dateString).toLocaleDateString('en-US', options);
}

async function getUserIP() {
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        return data.ip;
    } catch (error) {
        let deviceId = localStorage.getItem('device_id');
        if (!deviceId) {
            deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('device_id', deviceId);
        }
        return deviceId;
    }
}

async function checkIPBan(ip) {
    const { data, error } = await supabase
        .from('banned_ips')
        .select('*')
        .eq('ip_address', ip)
        .eq('is_active', true)
        .single();
    
    if (data) {
        document.body.innerHTML = `
            <div style="display:flex;justify-content:center;align-items:center;height:100vh;background:#0a0f1e;color:#f1f5f9;text-align:center;padding:20px;">
                <div>
                    <i class="fas fa-ban" style="font-size:72px;color:#ef4444;margin-bottom:20px;"></i>
                    <h1 style="font-size:32px;margin-bottom:16px;">Access Denied</h1>
                    <p style="color:#94a3b8;font-size:18px;">Your device has been banned from accessing this website.</p>
                    <p style="color:#94a3b8;font-size:14px;margin-top:12px;">Reason: ${data.reason || 'Unauthorized access attempt'}</p>
                </div>
            </div>
        `;
        throw new Error('IP Banned');
    }
}

function updateURL(path) {
    window.history.pushState({}, '', path);
}

// ======================================
// AUTHENTICATION
// ======================================

async function registerUser(username, password, pin) {
    try {
        const { data: existingUser } = await supabase
            .from('users')
            .select('id')
            .eq('username', username)
            .single();
        
        if (existingUser) {
            showToast('Username already exists', 'error');
            return false;
        }

        const { data: existingIP } = await supabase
            .from('users')
            .select('id')
            .eq('ip_address', userIP)
            .single();
        
        if (existingIP) {
            showToast('This device already has an account', 'error');
            return false;
        }

        const { data, error } = await supabase
            .from('users')
            .insert([{
                username,
                password,
                withdraw_pin: pin,
                ip_address: userIP
            }])
            .select()
            .single();

        if (error) throw error;

        showToast('Account created successfully!', 'success');
        
        currentUser = data;
        localStorage.setItem('user_id', data.id);
        localStorage.setItem('user_ip', userIP);
        
        showDashboard();
        return true;
    } catch (error) {
        console.error('Registration error:', error);
        showToast('Registration failed: ' + error.message, 'error');
        return false;
    }
}

async function loginUser(username, password) {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('username', username)
            .eq('password', password)
            .single();

        if (error || !data) {
            showToast('Invalid username or password', 'error');
            return false;
        }

        if (data.ip_address !== userIP) {
            await supabase
                .from('banned_ips')
                .insert([{
                    ip_address: userIP,
                    reason: 'Unauthorized login attempt for user: ' + username
                }]);
            
            await checkIPBan(userIP);
            return false;
        }

        if (data.is_banned) {
            showToast('Your account has been banned', 'error');
            return false;
        }

        currentUser = data;
        localStorage.setItem('user_id', data.id);
        localStorage.setItem('user_ip', userIP);
        
        showToast('Login successful!', 'success');
        showDashboard();
        return true;
    } catch (error) {
        console.error('Login error:', error);
        showToast('Login failed: ' + error.message, 'error');
        return false;
    }
}

async function checkAutoLogin() {
    const savedUserId = localStorage.getItem('user_id');
    const savedIP = localStorage.getItem('user_ip');

    if (savedUserId && savedIP === userIP) {
        const { data } = await supabase
            .from('users')
            .select('*')
            .eq('id', savedUserId)
            .eq('ip_address', userIP)
            .single();

        if (data && !data.is_banned) {
            currentUser = data;
            showDashboard();
            return true;
        }
    }
    return false;
}

// ======================================
// UI DISPLAY FUNCTIONS
// ======================================

async function showDashboard() {
    updateURL('/dashboard');
    document.getElementById('authContainer').classList.add('hidden');
    document.getElementById('mainDashboard').classList.remove('hidden');
    
    await loadSiteSettings();
    updateUserBalance();
    await loadMiningUI();
    await loadMiningSessions();
    await loadPlans();
    
    showPage('miningPage');
}

async function loadSiteSettings() {
    try {
        const { data: settings } = await supabase
            .from('site_settings')
            .select('*')
            .single();

        if (settings) {
            const logos = document.querySelectorAll('#siteLogo, #siteLogoLogin, #dashboardLogo');
            logos.forEach(logo => {
                if (settings.logo_url) {
                    logo.src = settings.logo_url;
                    logo.style.display = 'block';
                }
            });

            const names = document.querySelectorAll('#siteName, #siteNameLogin, #dashboardSiteName');
            names.forEach(name => {
                name.textContent = settings.site_name || 'MY MMK';
            });
        }
    } catch (error) {
        console.error('Error loading site settings:', error);
    }
}

async function loadMiningUI() {
    try {
        const { data: ui } = await supabase
            .from('mining_ui')
            .select('*')
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        const miningIcon = document.getElementById('miningIcon');
        
        if (ui && ui.ui_url) {
            miningIcon.innerHTML = `<img src="${ui.ui_url}" alt="Mining" style="width:100%;height:100%;object-fit:cover;border-radius:24px;">`;
        } else {
            miningIcon.innerHTML = '<i class="fas fa-pickaxe"></i>';
        }
    } catch (error) {
        console.error('Error loading mining UI:', error);
        document.getElementById('miningIcon').innerHTML = '<i class="fas fa-pickaxe"></i>';
    }
}

async function updateUserBalance() {
    if (!currentUser) return;

    const { data } = await supabase
        .from('users')
        .select('balance, total_coins')
        .eq('id', currentUser.id)
        .single();

    if (data) {
        currentUser.balance = data.balance;
        currentUser.total_coins = data.total_coins;

        document.getElementById('userBalance').textContent = formatCurrency(data.balance);
        document.getElementById('userTotalCoins').textContent = formatCurrency(data.total_coins);
        document.getElementById('miningBalance').textContent = formatCurrency(data.balance) + ' MMK';
        document.getElementById('miningTotal').textContent = formatCurrency(data.total_coins) + ' MMK';
        document.getElementById('profileBalance').textContent = formatCurrency(data.balance) + ' MMK';
    }
}

function showPage(pageId) {
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });

    document.getElementById(pageId).classList.add('active');

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-page="${pageId}"]`).classList.add('active');

    const pageName = pageId.replace('Page', '');
    updateURL('/' + pageName);

    switch(pageId) {
        case 'historyPage':
            loadHistory();
            break;
        case 'contactsPage':
            loadContacts();
            break;
        case 'newsPage':
            loadNews();
            break;
        case 'profilePage':
            loadProfile();
            break;
    }
}

// ======================================
// FIXED: MINING SYSTEM
// ======================================

async function loadMiningSessions() {
    try {
        // Check for active sessions
        const { data: sessions } = await supabase
            .from('user_mining_sessions')
            .select('*, plans(*)')
            .eq('user_id', currentUser.id)
            .eq('is_completed', false)
            .order('created_at', { ascending: false });

        // Reset display
        const startBtn = document.getElementById('startMiningBtn');
        const miningIcon = document.getElementById('miningIcon');
        const miningProgress = document.getElementById('miningProgress');
        
        if (sessions && sessions.length > 0) {
            sessions.forEach(session => {
                if (session.mining_type === 'free') {
                    activeFreeSession = session;
                    startFreeMining(session);
                } else if (session.mining_type === 'plan') {
                    activePlanSession = session;
                    startPlanMining(session);
                }
            });
        } else {
            // No active sessions - show start button
            startBtn.style.display = 'inline-flex';
            startBtn.disabled = false;
            miningIcon.classList.remove('mining-active');
            miningProgress.classList.add('hidden');
            
            document.getElementById('miningTypeName').textContent = 'Free Mining Available';
            document.getElementById('miningRate').textContent = 'Click Start to begin mining';
            document.getElementById('miningAmount').textContent = '0 MMK';
            document.getElementById('miningTimer').textContent = '';
            
            // Reload mining UI
            await loadMiningUI();
        }
    } catch (error) {
        console.error('Error loading mining sessions:', error);
    }
}

async function startFreeMiningSession() {
    try {
        // Get active free mining settings
        const { data: settings } = await supabase
            .from('free_mining_settings')
            .select('*')
            .eq('is_active', true)
            .single();

        if (!settings) {
            showToast('Free mining not available at the moment', 'error');
            return;
        }

        // Check if user already has active free mining
        const { data: existingSession } = await supabase
            .from('user_mining_sessions')
            .select('*')
            .eq('user_id', currentUser.id)
            .eq('mining_type', 'free')
            .eq('is_completed', false)
            .single();

        if (existingSession) {
            showToast('You already have an active free mining session', 'warning');
            return;
        }

        // Calculate end time based on duration_hours from when they start
        const startTime = new Date();
        const endTime = new Date(startTime.getTime() + (settings.duration_hours * 60 * 60 * 1000));

        console.log('Creating free mining session:', {
            duration_hours: settings.duration_hours,
            amount: settings.amount,
            start_time: startTime.toISOString(),
            end_time: endTime.toISOString()
        });

        // Create mining session
        const { data: session, error } = await supabase
            .from('user_mining_sessions')
            .insert([{
                user_id: currentUser.id,
                mining_type: 'free',
                start_time: startTime.toISOString(),
                end_time: endTime.toISOString(),
                target_amount: parseFloat(settings.amount),
                current_amount: 0,
                is_completed: false
            }])
            .select()
            .single();

        if (error) {
            console.error('Error creating session:', error);
            throw error;
        }

        console.log('Session created:', session);

        activeFreeSession = session;
        startFreeMining(session);
        showToast('Free mining started!', 'success');
        
        // Hide start button
        document.getElementById('startMiningBtn').style.display = 'none';
        
    } catch (error) {
        console.error('Error starting free mining:', error);
        showToast('Failed to start mining: ' + error.message, 'error');
    }
}

function startFreeMining(session) {
    console.log('Starting free mining display for session:', session);
    
    const miningIcon = document.getElementById('miningIcon');
    const miningTypeName = document.getElementById('miningTypeName');
    const miningRate = document.getElementById('miningRate');
    const miningAmount = document.getElementById('miningAmount');
    const miningTimer = document.getElementById('miningTimer');
    const miningProgress = document.getElementById('miningProgress');
    const startBtn = document.getElementById('startMiningBtn');

    // Update UI
    miningTypeName.textContent = 'Free Mining';
    miningProgress.classList.remove('hidden');
    miningIcon.classList.add('mining-active');
    
    // Hide start button
    startBtn.style.display = 'none';
    startBtn.disabled = true;

    // Calculate mining rate
    const startTime = new Date(session.start_time);
    const endTime = new Date(session.end_time);
    const totalSeconds = (endTime - startTime) / 1000;
    const ratePerSecond = session.target_amount / totalSeconds;

    console.log('Mining calculations:', {
        startTime,
        endTime,
        totalSeconds,
        ratePerSecond,
        targetAmount: session.target_amount
    });

    miningRate.textContent = `${formatCurrency(ratePerSecond * 60)} MMK/minute`;

    // Start mining counter
    const interval = setInterval(async () => {
        const now = new Date();
        const elapsed = (now - startTime) / 1000;
        const remaining = totalSeconds - elapsed;

        console.log('Mining tick:', { elapsed, remaining, totalSeconds });

        // Check if mining completed
        if (remaining <= 0 || elapsed >= totalSeconds) {
            clearInterval(interval);
            console.log('Mining completed, calling completeMiningSession');
            await completeMiningSession(session.id);
            return;
        }

        // Calculate current amount
        const currentAmount = Math.min(elapsed * ratePerSecond, session.target_amount);
        
        // Update display
        miningAmount.textContent = formatCurrency(currentAmount) + ' MMK';
        
        // Update timer
        const hours = Math.floor(remaining / 3600);
        const minutes = Math.floor((remaining % 3600) / 60);
        const seconds = Math.floor(remaining % 60);
        miningTimer.textContent = `${hours}h ${minutes}m ${seconds}s remaining`;

        // Update progress bar
        const progress = (elapsed / totalSeconds) * 100;
        document.querySelector('.progress-fill').style.width = progress + '%';

        // Update database every 10 seconds
        if (Math.floor(elapsed) % 10 === 0) {
            await supabase
                .from('user_mining_sessions')
                .update({ current_amount: currentAmount })
                .eq('id', session.id);
        }
    }, 1000);

    miningIntervals.push(interval);
}

function startPlanMining(session) {
    const hasFreeMining = activeFreeSession && !activeFreeSession.is_completed;
    
    if (hasFreeMining) {
        // Show in secondary area
        const secondaryMining = document.getElementById('secondaryMining');
        secondaryMining.classList.remove('hidden');
        
        const secondaryName = document.getElementById('secondaryMiningName');
        const secondaryAmount = document.getElementById('secondaryMiningAmount');

        secondaryName.textContent = session.plans?.name || 'Plan Mining';

        const startTime = new Date(session.start_time);
        const endTime = new Date(session.end_time);
        const totalSeconds = (endTime - startTime) / 1000;
        const ratePerSecond = session.target_amount / totalSeconds;

        const interval = setInterval(async () => {
            const now = new Date();
            const elapsed = (now - startTime) / 1000;
            const remaining = totalSeconds - elapsed;

            if (remaining <= 0) {
                clearInterval(interval);
                await completeMiningSession(session.id);
                return;
            }

            const currentAmount = Math.min(elapsed * ratePerSecond, session.target_amount);
            secondaryAmount.textContent = formatCurrency(currentAmount) + ' MMK';

            if (Math.floor(elapsed) % 10 === 0) {
                await supabase
                    .from('user_mining_sessions')
                    .update({ current_amount: currentAmount })
                    .eq('id', session.id);
            }
        }, 1000);

        miningIntervals.push(interval);

        const secondaryCard = document.getElementById('secondaryMiningCard');
        secondaryCard.onclick = () => switchMiningDisplay('plan');
    } else {
        displayPlanMiningMain(session);
    }
}

function displayPlanMiningMain(session) {
    const miningIcon = document.getElementById('miningIcon');
    const miningTypeName = document.getElementById('miningTypeName');
    const miningRate = document.getElementById('miningRate');
    const miningAmount = document.getElementById('miningAmount');
    const miningTimer = document.getElementById('miningTimer');
    const miningProgress = document.getElementById('miningProgress');
    const startBtn = document.getElementById('startMiningBtn');

    miningTypeName.textContent = session.plans?.name || 'Plan Mining';
    miningProgress.classList.remove('hidden');
    miningIcon.classList.add('mining-active');
    startBtn.style.display = 'none';

    if (session.plans?.ui_url) {
        miningIcon.innerHTML = `<img src="${session.plans.ui_url}" alt="Plan" style="width:100%;height:100%;object-fit:cover;border-radius:24px;">`;
    }

    const startTime = new Date(session.start_time);
    const endTime = new Date(session.end_time);
    const totalSeconds = (endTime - startTime) / 1000;
    const ratePerSecond = session.target_amount / totalSeconds;

    miningRate.textContent = `${formatCurrency(ratePerSecond * 60)} MMK/minute`;

    const interval = setInterval(async () => {
        const now = new Date();
        const elapsed = (now - startTime) / 1000;
        const remaining = totalSeconds - elapsed;

        if (remaining <= 0) {
            clearInterval(interval);
            await completeMiningSession(session.id);
            return;
        }

        const currentAmount = Math.min(elapsed * ratePerSecond, session.target_amount);
        miningAmount.textContent = formatCurrency(currentAmount) + ' MMK';
        
        const hours = Math.floor(remaining / 3600);
        const minutes = Math.floor((remaining % 3600) / 60);
        const seconds = Math.floor(remaining % 60);
        miningTimer.textContent = `${hours}h ${minutes}m ${seconds}s remaining`;

        const progress = (elapsed / totalSeconds) * 100;
        document.querySelector('.progress-fill').style.width = progress + '%';

        if (Math.floor(elapsed) % 10 === 0) {
            await supabase
                .from('user_mining_sessions')
                .update({ current_amount: currentAmount })
                .eq('id', session.id);
        }
    }, 1000);

    miningIntervals.push(interval);
}

function switchMiningDisplay(type) {
    // Clear all intervals
    miningIntervals.forEach(interval => clearInterval(interval));
    miningIntervals = [];

    if (type === 'plan' && activePlanSession) {
        displayPlanMiningMain(activePlanSession);
        
        if (activeFreeSession) {
            const secondaryMining = document.getElementById('secondaryMining');
            secondaryMining.classList.remove('hidden');
            
            const secondaryName = document.getElementById('secondaryMiningName');
            secondaryName.textContent = 'Free Mining';
            
            startFreeMining(activeFreeSession);
        }
    } else if (type === 'free' && activeFreeSession) {
        startFreeMining(activeFreeSession);
        
        if (activePlanSession) {
            startPlanMining(activePlanSession);
        }
    }
}

async function completeMiningSession(sessionId) {
    try {
        console.log('Completing mining session:', sessionId);
        
        // Get session details
        const { data: session } = await supabase
            .from('user_mining_sessions')
            .select('*')
            .eq('id', sessionId)
            .single();

        if (!session) {
            console.error('Session not found');
            return;
        }

        console.log('Session to complete:', session);

        // Mark session as completed
        const { error: updateError } = await supabase
            .from('user_mining_sessions')
            .update({ 
                is_completed: true,
                current_amount: session.target_amount,
                completed_at: new Date().toISOString()
            })
            .eq('id', sessionId);

        if (updateError) {
            console.error('Error updating session:', updateError);
            throw updateError;
        }

        // Update user balance will be handled by trigger
        await updateUserBalance();
        
        showToast(`Mining completed! ${formatCurrency(session.target_amount)} MMK added to balance`, 'success');

        // Clear intervals
        miningIntervals.forEach(interval => clearInterval(interval));
        miningIntervals = [];

        if (session.mining_type === 'free') {
            activeFreeSession = null;
            
            // Reset UI to show start button again
            const startBtn = document.getElementById('startMiningBtn');
            startBtn.style.display = 'inline-flex';
            startBtn.disabled = false;
            
            document.getElementById('miningIcon').classList.remove('mining-active');
            document.getElementById('miningProgress').classList.add('hidden');
            document.getElementById('miningTypeName').textContent = 'Free Mining Available';
            document.getElementById('miningRate').textContent = 'Click Start to begin mining';
            document.getElementById('miningAmount').textContent = '0 MMK';
            document.getElementById('miningTimer').textContent = '';
            
            // Reload mining UI
            await loadMiningUI();
        } else {
            activePlanSession = null;
            document.getElementById('secondaryMining').classList.add('hidden');
        }

        // Reload sessions to check if there are more
        await loadMiningSessions();
        
    } catch (error) {
        console.error('Error completing mining:', error);
        showToast('Error completing mining session', 'error');
    }
}

// ======================================
// PLANS SYSTEM
// ======================================

async function loadPlans() {
    try {
        const { data: plans } = await supabase
            .from('plans')
            .select('*')
            .eq('is_active', true)
            .order('price', { ascending: true });

        const plansContainer = document.getElementById('plansContainer');
        
        if (!plans || plans.length === 0) {
            plansContainer.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-gem"></i>
                    <p>No plans available</p>
                </div>
            `;
            return;
        }

        plansContainer.innerHTML = plans.map(plan => `
            <div class="plan-card">
                ${plan.ui_url ? `<img src="${plan.ui_url}" alt="${plan.name}" class="plan-image">` : ''}
                <h3>${plan.name}</h3>
                <div class="plan-details">
                    <div class="plan-detail-item">
                        <span>Duration</span>
                        <span>${plan.duration_hours} hours</span>
                    </div>
                    <div class="plan-detail-item">
                        <span>Total Mining</span>
                        <span>${formatCurrency(plan.total_amount)} MMK</span>
                    </div>
                    <div class="plan-detail-item">
                        <span>Rate/Hour</span>
                        <span>${formatCurrency(plan.total_amount / plan.duration_hours)} MMK</span>
                    </div>
                </div>
                <div class="plan-price">${formatCurrency(plan.price)} MMK</div>
                <button class="btn-buy-plan" onclick="buyPlan('${plan.id}')">
                    <i class="fas fa-shopping-cart"></i> Buy Now
                </button>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading plans:', error);
    }
}

async function buyPlan(planId) {
    try {
        // Check if user already has an active plan
        const { data: activeSessions } = await supabase
            .from('user_mining_sessions')
            .select('*')
            .eq('user_id', currentUser.id)
            .eq('mining_type', 'plan')
            .eq('is_completed', false);

        if (activeSessions && activeSessions.length > 0) {
            showToast('You already have an active plan. Complete it before buying a new one.', 'warning');
            return;
        }

        // Get plan details
        const { data: plan } = await supabase
            .from('plans')
            .select('*')
            .eq('id', planId)
            .single();

        if (!plan) {
            showToast('Plan not found', 'error');
            return;
        }

        // Load payment options
        const { data: payments } = await supabase
            .from('payments')
            .select('*')
            .eq('is_active', true);

        if (!payments || payments.length === 0) {
            showToast('No payment methods available', 'error');
            return;
        }

        // Show payment modal
        const modal = document.getElementById('planPurchaseModal');
        const content = document.getElementById('planPurchaseContent');
        
        content.innerHTML = `
            <div class="plan-summary" style="background: var(--dark-bg); padding: 16px; border-radius: 12px; margin-bottom: 20px;">
                <h4>${plan.name}</h4>
                <p>Duration: ${plan.duration_hours} hours</p>
                <p>Mining Amount: ${formatCurrency(plan.total_amount)} MMK</p>
                <p style="color: var(--primary-color); font-size: 20px; font-weight: bold; margin-top: 10px;">Price: ${formatCurrency(plan.price)} MMK</p>
            </div>
            
            <h4 style="margin-bottom: 12px;">Select Payment Method:</h4>
            <div class="payment-options">
                ${payments.map(payment => `
                    <div class="payment-option" data-payment-id="${payment.id}">
                        ${payment.icon_url ? `<img src="${payment.icon_url}" alt="${payment.name}">` : '<i class="fas fa-wallet" style="font-size:48px;"></i>'}
                        <div class="payment-option-info">
                            <h4>${payment.name}</h4>
                            <p>Click to select</p>
                        </div>
                    </div>
                `).join('')}
            </div>
            
            <div id="paymentDetailsSection" class="hidden">
                <div class="payment-details" id="selectedPaymentDetails"></div>
                
                <div class="form-group">
                    <label>Transaction Last 6 Digits</label>
                    <input type="text" id="transactionLast6" maxlength="6" pattern="[0-9A-Za-z]{6}" placeholder="Enter last 6 digits of transaction ID" required>
                    <small class="text-muted">Enter the last 6 characters of your payment transaction ID</small>
                </div>
                
                <button class="btn-primary" onclick="submitPlanPurchase('${planId}')">
                    <i class="fas fa-check"></i> Submit Purchase
                </button>
            </div>
        `;

        modal.classList.add('active');

        // Add payment selection listeners
        document.querySelectorAll('.payment-option').forEach(option => {
            option.onclick = function() {
                document.querySelectorAll('.payment-option').forEach(opt => opt.classList.remove('selected'));
                this.classList.add('selected');
                
                const paymentId = this.dataset.paymentId;
                const payment = payments.find(p => p.id === paymentId);
                
                document.getElementById('selectedPaymentDetails').innerHTML = `
                    <h4>${payment.name}</h4>
                    <div class="payment-detail-item">
                        <label>Payment Address:</label>
                        <p>${payment.address}</p>
                    </div>
                    ${payment.instructions ? `
                        <div class="payment-detail-item">
                            <label>Instructions:</label>
                            <p>${payment.instructions}</p>
                        </div>
                    ` : ''}
                    <div class="payment-detail-item">
                        <label>Amount to Pay:</label>
                        <p style="color: var(--primary-color); font-size: 22px; font-weight: bold;">${formatCurrency(plan.price)} MMK</p>
                    </div>
                    <div class="payment-detail-item" style="background: rgba(245, 158, 11, 0.1); padding: 12px; border-radius: 8px; border: 1px solid var(--warning-color);">
                        <label style="color: var(--warning-color);">⚠️ Important:</label>
                        <p style="color: var(--warning-color); font-size: 13px;">Please transfer the exact amount and save your transaction ID. You'll need the last 6 digits.</p>
                    </div>
                `;
                
                document.getElementById('paymentDetailsSection').classList.remove('hidden');
            };
        });
    } catch (error) {
        console.error('Error buying plan:', error);
        showToast('Failed to load payment options', 'error');
    }
}

window.submitPlanPurchase = async function(planId) {
    const selectedPayment = document.querySelector('.payment-option.selected');
    if (!selectedPayment) {
        showToast('Please select a payment method', 'error');
        return;
    }

    const transactionLast6 = document.getElementById('transactionLast6').value.trim();
    if (!transactionLast6 || transactionLast6.length !== 6) {
        showToast('Please enter valid transaction last 6 digits', 'error');
        return;
    }

    try {
        const { data, error } = await supabase
            .from('user_plan_purchases')
            .insert([{
                user_id: currentUser.id,
                plan_id: planId,
                payment_id: selectedPayment.dataset.paymentId,
                transaction_last_6: transactionLast6.toUpperCase(),
                status: 'pending'
            }])
            .select()
            .single();

        if (error) throw error;

        showToast('Purchase request submitted successfully! Please wait for admin approval.', 'success');
        document.getElementById('planPurchaseModal').classList.remove('active');
        
        await loadPlans();
    } catch (error) {
        console.error('Error submitting purchase:', error);
        showToast('Failed to submit purchase: ' + error.message, 'error');
    }
};

// ======================================
// HISTORY PAGE
// ======================================

async function loadHistory() {
    loadPlanHistory();
    loadFreeHistory();
    loadPurchaseHistory();
}

async function loadPlanHistory() {
    const { data: history } = await supabase
        .from('mining_history')
        .select('*')
        .eq('user_id', currentUser.id)
        .eq('mining_type', 'plan')
        .order('created_at', { ascending: false })
        .limit(50);

    const container = document.getElementById('planHistory');
    
    if (!history || history.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-history"></i><p>No plan mining history</p></div>';
        return;
    }

    container.innerHTML = history.map(item => `
        <div class="history-item">
            <div class="history-item-header">
                <h4>Plan Mining</h4>
                <span class="status-badge approved">${formatCurrency(item.amount)} MMK</span>
            </div>
            <div class="history-item-details">
                <div class="history-detail-row">
                    <span>Date</span>
                    <span>${formatDate(item.created_at)}</span>
                </div>
            </div>
        </div>
    `).join('');
}

async function loadFreeHistory() {
    const { data: history } = await supabase
        .from('mining_history')
        .select('*')
        .eq('user_id', currentUser.id)
        .eq('mining_type', 'free')
        .order('created_at', { ascending: false })
        .limit(50);

    const container = document.getElementById('freeHistory');
    
    if (!history || history.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-history"></i><p>No free mining history</p></div>';
        return;
    }

    container.innerHTML = history.map(item => `
        <div class="history-item">
            <div class="history-item-header">
                <h4>Free Mining</h4>
                <span class="status-badge approved">${formatCurrency(item.amount)} MMK</span>
            </div>
            <div class="history-item-details">
                <div class="history-detail-row">
                    <span>Date</span>
                    <span>${formatDate(item.created_at)}</span>
                </div>
            </div>
        </div>
    `).join('');
}

async function loadPurchaseHistory() {
    const { data: purchases } = await supabase
        .from('user_plan_purchases')
        .select('*, plans(name, price), payments(name)')
        .eq('user_id', currentUser.id)
        .order('purchased_at', { ascending: false });

    const container = document.getElementById('purchaseHistory');
    
    if (!purchases || purchases.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-shopping-cart"></i><p>No purchase history</p></div>';
        return;
    }

    container.innerHTML = purchases.map(purchase => `
        <div class="history-item">
            <div class="history-item-header">
                <h4>${purchase.plans?.name || 'Plan'}</h4>
                <span class="status-badge ${purchase.status}">${purchase.status}</span>
            </div>
            <div class="history-item-details">
                <div class="history-detail-row">
                    <span>Order Number</span>
                    <span>${purchase.order_number}</span>
                </div>
                <div class="history-detail-row">
                    <span>Amount</span>
                    <span>${formatCurrency(purchase.plans?.price || 0)} MMK</span>
                </div>
                <div class="history-detail-row">
                    <span>Payment</span>
                    <span>${purchase.payments?.name || 'N/A'}</span>
                </div>
                <div class="history-detail-row">
                    <span>Transaction</span>
                    <span>...${purchase.transaction_last_6}</span>
                </div>
                <div class="history-detail-row">
                    <span>Date</span>
                    <span>${formatDate(purchase.purchased_at)}</span>
                </div>
                ${purchase.status === 'approved' && purchase.approved_at ? `
                    <div class="history-detail-row">
                        <span>Approved At</span>
                        <span>${formatDate(purchase.approved_at)}</span>
                    </div>
                ` : ''}
            </div>
        </div>
    `).join('');
}

// ======================================
// CONTACTS PAGE
// ======================================

async function loadContacts() {
    const { data: contacts } = await supabase
        .from('contacts')
        .select('*')
        .eq('is_active', true)
        .order('display_order', { ascending: true });

    const container = document.getElementById('contactsContainer');
    
    if (!contacts || contacts.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-address-book"></i><p>No contacts available</p></div>';
        return;
    }

    container.innerHTML = contacts.map(contact => `
        <div class="contact-card" onclick="window.open('${contact.link}', '_blank')">
            ${contact.icon_url ? 
                `<img src="${contact.icon_url}" alt="${contact.name}" class="contact-icon">` : 
                '<i class="fas fa-link" style="font-size: 48px; color: var(--primary-color);"></i>'
            }
            <h3>${contact.name}</h3>
            <p>${contact.description || 'Click to contact'}</p>
        </div>
    `).join('');
}

// ======================================
// NEWS PAGE WITH MODAL VIEW
// ======================================

async function loadNews() {
    const { data: news } = await supabase
        .from('news')
        .select('*, news_media(*)')
        .eq('is_published', true)
        .order('created_at', { ascending: false });

    const container = document.getElementById('newsContainer');
    
    if (!news || news.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-newspaper"></i><p>No news available</p></div>';
        return;
    }

    container.innerHTML = news.map(item => {
        const firstImage = item.news_media?.find(m => m.media_type === 'image');
        const mediaCount = item.news_media?.length || 0;
        
        return `
            <div class="news-card" onclick="showNewsDetail('${item.id}')">
                ${firstImage ? 
                    `<img src="${firstImage.media_url}" alt="News" class="news-preview-image">` : 
                    ''
                }
                <div class="news-preview-content">
                    <h3>${item.title}</h3>
                    <p>${item.content.substring(0, 150)}${item.content.length > 150 ? '...' : ''}</p>
                    <div class="news-meta">
                        <span><i class="fas fa-calendar"></i> ${formatDate(item.created_at)}</span>
                        ${mediaCount > 0 ? `<span><i class="fas fa-images"></i> ${mediaCount} media</span>` : ''}
                        ${item.youtube_url ? `<span><i class="fab fa-youtube"></i> Video</span>` : ''}
                    </div>
                    <button class="btn-read-more">Read More <i class="fas fa-arrow-right"></i></button>
                </div>
            </div>
        `;
    }).join('');
}

window.showNewsDetail = async function(newsId) {
    try {
        const { data: item } = await supabase
            .from('news')
            .select('*, news_media(*)')
            .eq('id', newsId)
            .single();

        if (!item) return;

        // Build contacts HTML
        let contactsHTML = '';
        if (item.contact_ids && item.contact_ids.length > 0) {
            const { data: contacts } = await supabase
                .from('contacts')
                .select('*')
                .in('id', item.contact_ids);
            
            if (contacts && contacts.length > 0) {
                contactsHTML = `
                    <div class="news-contacts">
                        <h4>Contact Us:</h4>
                        <div class="news-contact-buttons">
                            ${contacts.map(contact => `
                                <a href="${contact.link}" target="_blank" class="news-contact-btn">
                                    ${contact.icon_url ? `<img src="${contact.icon_url}" class="news-contact-icon">` : '<i class="fas fa-link"></i>'}
                                    ${contact.name}
                                </a>
                            `).join('')}
                        </div>
                    </div>
                `;
            }
        }

        // Build media HTML
        let mediaHTML = '';
        if (item.news_media && item.news_media.length > 0) {
            const images = item.news_media.filter(m => m.media_type === 'image');
            const videos = item.news_media.filter(m => m.media_type === 'video');
            
            if (images.length > 0) {
                mediaHTML += `
                    <div class="news-images-grid">
                        ${images.map(img => 
                            `<img src="${img.media_url}" alt="News" onclick="window.open('${img.media_url}', '_blank')" style="cursor:pointer;">`
                        ).join('')}
                    </div>
                `;
            }
            
            if (videos.length > 0) {
                mediaHTML += videos.map(vid => 
                    `<video src="${vid.media_url}" controls class="news-video"></video>`
                ).join('');
            }
        }

        // Add YouTube video
        if (item.youtube_url) {
            let videoId = '';
            if (item.youtube_url.includes('youtube.com/watch?v=')) {
                videoId = item.youtube_url.split('v=')[1].split('&')[0];
            } else if (item.youtube_url.includes('youtu.be/')) {
                videoId = item.youtube_url.split('youtu.be/')[1].split('?')[0];
            } else if (item.youtube_url.includes('youtube.com/shorts/')) {
                videoId = item.youtube_url.split('shorts/')[1].split('?')[0];
            }
            
            if (videoId) {
                mediaHTML += `<iframe src="https://www.youtube.com/embed/${videoId}" class="news-youtube" allowfullscreen></iframe>`;
            }
        }

        // Create modal
        const modalHTML = `
            <div class="modal active" id="newsDetailModal" onclick="if(event.target === this) this.remove()">
                <div class="modal-content large">
                    <span class="close" onclick="document.getElementById('newsDetailModal').remove()">&times;</span>
                    <div class="news-detail-content">
                        <h2>${item.title}</h2>
                        ${mediaHTML}
                        <div class="news-full-content">
                            <p style="white-space: pre-wrap;">${item.content}</p>
                        </div>
                        ${contactsHTML}
                        <p class="news-date"><i class="fas fa-calendar"></i> Published on ${formatDate(item.created_at)}</p>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
    } catch (error) {
        console.error('Error loading news detail:', error);
        showToast('Failed to load news details', 'error');
    }
};

// ======================================
// PROFILE PAGE
// ======================================

async function loadProfile() {
    document.getElementById('profileUsername').value = currentUser.username;
    await loadWithdrawalHistory();
}

async function loadWithdrawalHistory() {
    const { data: withdrawals } = await supabase
        .from('withdrawal_requests')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('requested_at', { ascending: false });

    const container = document.getElementById('withdrawalHistoryContainer');
    
    if (!withdrawals || withdrawals.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-money-bill-wave"></i><p>No withdrawal history</p></div>';
        return;
    }

    container.innerHTML = withdrawals.map(withdrawal => `
        <div class="history-item">
            <div class="history-item-header">
                <h4>${formatCurrency(withdrawal.amount)} MMK</h4>
                <span class="status-badge ${withdrawal.status}">${withdrawal.status}</span>
            </div>
            <div class="history-item-details">
                <div class="history-detail-row">
                    <span>Payment Type</span>
                    <span>${withdrawal.payment_type}</span>
                </div>
                <div class="history-detail-row">
                    <span>Account Name</span>
                    <span>${withdrawal.account_name}</span>
                </div>
                <div class="history-detail-row">
                    <span>Address</span>
                    <span>${withdrawal.payment_address}</span>
                </div>
                <div class="history-detail-row">
                    <span>Requested</span>
                    <span>${formatDate(withdrawal.requested_at)}</span>
                </div>
                ${withdrawal.processed_at ? `
                    <div class="history-detail-row">
                        <span>Processed</span>
                        <span>${formatDate(withdrawal.processed_at)}</span>
                    </div>
                ` : ''}
            </div>
        </div>
    `).join('');
}

document.getElementById('updateProfileBtn')?.addEventListener('click', async () => {
    const newPassword = document.getElementById('profileNewPassword').value.trim();
    const newPin = document.getElementById('profileNewPin').value.trim();

    const updates = {};
    if (newPassword) updates.password = newPassword;
    if (newPin && newPin.length === 6) updates.withdraw_pin = newPin;

    if (Object.keys(updates).length === 0) {
        showToast('No changes to update', 'warning');
        return;
    }

    try {
        const { error } = await supabase
            .from('users')
            .update(updates)
            .eq('id', currentUser.id);

        if (error) throw error;

        // Update current user object
        if (updates.password) currentUser.password = updates.password;
        if (updates.withdraw_pin) currentUser.withdraw_pin = updates.withdraw_pin;

        showToast('Profile updated successfully', 'success');
        
        document.getElementById('profileNewPassword').value = '';
        document.getElementById('profileNewPin').value = '';
    } catch (error) {
        console.error('Error updating profile:', error);
        showToast('Failed to update profile', 'error');
    }
});

document.getElementById('withdrawBtn')?.addEventListener('click', () => {
    const modal = document.getElementById('withdrawalModal');
    document.getElementById('withdrawAvailableBalance').textContent = formatCurrency(currentUser.balance) + ' MMK';
    modal.classList.add('active');
});

document.getElementById('withdrawalForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const amount = parseFloat(document.getElementById('withdrawAmount').value);
    const paymentType = document.getElementById('withdrawPaymentType').value.trim();
    const accountName = document.getElementById('withdrawAccountName').value.trim();
    const paymentAddress = document.getElementById('withdrawPaymentAddress').value.trim();
    const pin = document.getElementById('withdrawPin').value.trim();

    // Verify PIN
    if (pin !== currentUser.withdraw_pin) {
        showToast('Invalid withdrawal PIN', 'error');
        return;
    }

    // Check withdrawal limits
    const { data: checkResult } = await supabase
        .rpc('check_withdrawal_limits', {
            p_user_id: currentUser.id,
            p_amount: amount
        });

    if (checkResult && checkResult.length > 0) {
        const check = checkResult[0];
        if (!check.can_withdraw) {
            showToast(check.message, 'error');
            return;
        }
    }

    try {
        // Deduct from balance temporarily
        const { error: balanceError } = await supabase
            .from('users')
            .update({ balance: currentUser.balance - amount })
            .eq('id', currentUser.id);

        if (balanceError) throw balanceError;

        // Create withdrawal request
        const { error } = await supabase
            .from('withdrawal_requests')
            .insert([{
                user_id: currentUser.id,
                amount,
                payment_type: paymentType,
                account_name: accountName,
                payment_address: paymentAddress,
                status: 'pending'
            }]);

        if (error) throw error;

        showToast('Withdrawal request submitted! Please wait for approval.', 'success');
        document.getElementById('withdrawalModal').classList.remove('active');
        document.getElementById('withdrawalForm').reset();
        
        await updateUserBalance();
        await loadWithdrawalHistory();
    } catch (error) {
        console.error('Error submitting withdrawal:', error);
        showToast('Failed to submit withdrawal request', 'error');
        
        // Restore balance if failed
        await supabase
            .from('users')
            .update({ balance: currentUser.balance })
            .eq('id', currentUser.id);
    }
});

// ======================================
// EVENT LISTENERS
// ======================================

// Auth Form Switching
document.getElementById('showLogin')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('registerForm').classList.add('hidden');
    document.getElementById('loginForm').classList.remove('hidden');
    updateURL('/login');
});

document.getElementById('showRegister')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('registerForm').classList.remove('hidden');
    updateURL('/register');
});

// Register Form
document.getElementById('registerFormElement')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value;
    const pin = document.getElementById('regPin').value.trim();
    
    if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
        showToast('PIN must be exactly 6 digits', 'error');
        return;
    }
    
    await registerUser(username, password, pin);
});

// Login Form
document.getElementById('loginFormElement')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    
    await loginUser(username, password);
});

// Navigation
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const pageId = btn.dataset.page;
        showPage(pageId);
    });
});

// History Tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tabId = btn.dataset.tab;
        
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.history-tab').forEach(t => t.classList.remove('active'));
        
        btn.classList.add('active');
        document.getElementById(tabId).classList.add('active');
    });
});

// Start Mining Button
document.getElementById('startMiningBtn')?.addEventListener('click', () => {
    console.log('Start mining button clicked');
    startFreeMiningSession();
});

// Modal Close Buttons
document.querySelectorAll('.modal .close').forEach(closeBtn => {
    closeBtn.addEventListener('click', () => {
        closeBtn.closest('.modal').classList.remove('active');
    });
});

// Close modal on outside click
document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
        }
    });
});

// ======================================
// INITIALIZATION
// ======================================

async function init() {
    try {
        console.log('Initializing application...');
        
        // Get user IP
        userIP = await getUserIP();
        console.log('User IP:', userIP);
        
        // Check if IP is banned
        await checkIPBan(userIP);
        
        // Check auto login
        const autoLoggedIn = await checkAutoLogin();
        
        if (!autoLoggedIn) {
            // Show auth container
            document.getElementById('authContainer').classList.remove('hidden');
            updateURL('/register');
        }
        
        // Hide loading screen
        document.getElementById('loadingScreen').style.display = 'none';
        
        console.log('Application initialized successfully');
    } catch (error) {
        console.error('Initialization error:', error);
        document.getElementById('loadingScreen').style.display = 'none';
        showToast('Failed to initialize application', 'error');
    }
}

// Start app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Handle browser back/forward
window.addEventListener('popstate', () => {
    // Handle URL changes if needed
    console.log('URL changed:', window.location.pathname);
});

// Cleanup intervals on page unload
window.addEventListener('beforeunload', () => {
    miningIntervals.forEach(interval => clearInterval(interval));
});

// Prevent multiple clicks on buttons
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('btn-primary') || 
        e.target.classList.contains('btn-mining') ||
        e.target.closest('.btn-primary') ||
        e.target.closest('.btn-mining')) {
        const btn = e.target.classList.contains('btn-primary') || e.target.classList.contains('btn-mining') 
            ? e.target 
            : e.target.closest('.btn-primary, .btn-mining');
        
        if (btn.disabled) {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }
    }
}, true);

console.log('MY MMK Mining Platform - User Dashboard Loaded');
console.log('Version: 1.0.0');
console.log('Database: Supabase');
console.log('Ready to mine! 🚀');
