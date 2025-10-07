/* ======================================
   MY MMK - User Dashboard JavaScript
   ====================================== */

// Supabase Configuration
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

// Show Toast Notification
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast show ${type}`;
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Format Currency
function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    }).format(amount);
}

// Format Date
function formatDate(dateString) {
    const options = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    return new Date(dateString).toLocaleDateString('en-US', options);
}

// Get User IP Address
async function getUserIP() {
    try {
        // Try to get local IP first (more reliable for device identification)
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        return data.ip;
    } catch (error) {
        // Fallback to generating a unique device ID
        let deviceId = localStorage.getItem('device_id');
        if (!deviceId) {
            deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('device_id', deviceId);
        }
        return deviceId;
    }
}

// Check if IP is Banned
async function checkIPBan(ip) {
    const { data, error } = await supabase
        .from('banned_ips')
        .select('*')
        .eq('ip_address', ip)
        .single();
    
    if (data) {
        document.body.innerHTML = `
            <div style="display:flex;justify-content:center;align-items:center;height:100vh;background:#0f172a;color:#f1f5f9;text-align:center;padding:20px;">
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

// Update URL Path
function updateURL(path) {
    window.history.pushState({}, '', path);
}

// ======================================
// AUTHENTICATION
// ======================================

// Register User
async function registerUser(username, password, pin) {
    try {
        // Check if username already exists
        const { data: existingUser } = await supabase
            .from('users')
            .select('id')
            .eq('username', username)
            .single();
        
        if (existingUser) {
            showToast('Username already exists', 'error');
            return false;
        }

        // Check if IP already has an account
        const { data: existingIP } = await supabase
            .from('users')
            .select('id')
            .eq('ip_address', userIP)
            .single();
        
        if (existingIP) {
            showToast('This device already has an account', 'error');
            return false;
        }

        // Create user
        const { data, error } = await supabase
            .from('users')
            .insert([{
                username,
                password, // In production, this should be hashed
                withdraw_pin: pin,
                ip_address: userIP
            }])
            .select()
            .single();

        if (error) throw error;

        showToast('Account created successfully!', 'success');
        
        // Auto login
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

// Login User
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

        // Check if IP matches
        if (data.ip_address !== userIP) {
            // Attempt from different device - ban this IP
            await supabase
                .from('banned_ips')
                .insert([{
                    ip_address: userIP,
                    reason: 'Unauthorized login attempt for user: ' + username
                }]);
            
            await checkIPBan(userIP); // This will block the page
            return false;
        }

        // Check if user is banned
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

// Check Auto Login
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

// Show Dashboard
async function showDashboard() {
    updateURL('/dashboard');
    document.getElementById('authContainer').classList.add('hidden');
    document.getElementById('mainDashboard').classList.remove('hidden');
    
    // Load site settings
    await loadSiteSettings();
    
    // Update user balance
    updateUserBalance();
    
    // Load active mining sessions
    await loadMiningeSessions();
    
    // Load plans
    await loadPlans();
    
    // Show mining page by default
    showPage('miningPage');
}

// Load Site Settings
async function loadSiteSettings() {
    try {
        const { data: settings } = await supabase
            .from('site_settings')
            .select('*')
            .single();

        if (settings) {
            // Update logos
            const logos = document.querySelectorAll('#siteLogo, #siteLogoLogin, #dashboardLogo');
            logos.forEach(logo => {
                if (settings.logo_url) {
                    logo.src = settings.logo_url;
                    logo.style.display = 'block';
                }
            });

            // Update site names
            const names = document.querySelectorAll('#siteName, #siteNameLogin, #dashboardSiteName');
            names.forEach(name => {
                name.textContent = settings.site_name || 'MY MMK';
            });
        }

        // Load button UI
        const { data: buttonUI } = await supabase
            .from('button_ui')
            .select('*');

        // Can customize button icons here if needed
    } catch (error) {
        console.error('Error loading site settings:', error);
    }
}

// Update User Balance Display
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

        // Update all balance displays
        document.getElementById('userBalance').textContent = formatCurrency(data.balance);
        document.getElementById('userTotalCoins').textContent = formatCurrency(data.total_coins);
        document.getElementById('miningBalance').textContent = formatCurrency(data.balance) + ' MMK';
        document.getElementById('miningTotal').textContent = formatCurrency(data.total_coins) + ' MMK';
        document.getElementById('profileBalance').textContent = formatCurrency(data.balance) + ' MMK';
    }
}

// Show Page
function showPage(pageId) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });

    // Show selected page
    document.getElementById(pageId).classList.add('active');

    // Update navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-page="${pageId}"]`).classList.add('active');

    // Update URL
    const pageName = pageId.replace('Page', '');
    updateURL('/' + pageName);

    // Load page-specific content
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
// MINING SYSTEM
// ======================================

// Load Mining Sessions
async function loadMiningeSessions() {
    try {
        // Get active sessions
        const { data: sessions } = await supabase
            .from('user_mining_sessions')
            .select('*, plans(*)')
            .eq('user_id', currentUser.id)
            .eq('is_completed', false)
            .order('created_at', { ascending: false });

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
            // Show start mining button
            document.getElementById('startMiningBtn').style.display = 'inline-flex';
        }
    } catch (error) {
        console.error('Error loading mining sessions:', error);
    }
}

// Start Free Mining
async function startFreeMiningSession() {
    try {
        // Get free mining settings
        const { data: settings } = await supabase
            .from('free_mining_settings')
            .select('*')
            .eq('is_active', true)
            .single();

        if (!settings) {
            showToast('Free mining not available', 'error');
            return;
        }

        // Calculate duration in hours
        const startTime = new Date();
        startTime.setHours(parseInt(settings.start_time.split(':')[0]), parseInt(settings.start_time.split(':')[1]), 0);
        
        const endTime = new Date();
        endTime.setHours(parseInt(settings.end_time.split(':')[0]), parseInt(settings.end_time.split(':')[1]), 0);
        
        if (endTime < startTime) {
            endTime.setDate(endTime.getDate() + 1);
        }

        // Create mining session
        const { data: session, error } = await supabase
            .from('user_mining_sessions')
            .insert([{
                user_id: currentUser.id,
                mining_type: 'free',
                start_time: new Date().toISOString(),
                end_time: endTime.toISOString(),
                target_amount: parseFloat(settings.amount),
                current_amount: 0
            }])
            .select()
            .single();

        if (error) throw error;

        activeFreeSession = session;
        startFreeMining(session);
        showToast('Free mining started!', 'success');
        
        document.getElementById('startMiningBtn').style.display = 'none';
    } catch (error) {
        console.error('Error starting free mining:', error);
        showToast('Failed to start mining', 'error');
    }
}

// Start Free Mining Display
function startFreeMining(session) {
    const miningIcon = document.getElementById('miningIcon');
    const miningTypeName = document.getElementById('miningTypeName');
    const miningRate = document.getElementById('miningRate');
    const miningAmount = document.getElementById('miningAmount');
    const miningTimer = document.getElementById('miningTimer');
    const miningProgress = document.getElementById('miningProgress');

    miningTypeName.textContent = 'Free Mining';
    miningProgress.classList.remove('hidden');
    miningIcon.classList.add('mining-active');

    // Calculate mining rate per second
    const startTime = new Date(session.start_time);
    const endTime = new Date(session.end_time);
    const totalSeconds = (endTime - startTime) / 1000;
    const ratePerSecond = session.target_amount / totalSeconds;

    miningRate.textContent = `${formatCurrency(ratePerSecond * 60)} MMK/minute`;

    // Update mining display
    const interval = setInterval(async () => {
        const now = new Date();
        const elapsed = (now - startTime) / 1000;
        const remaining = totalSeconds - elapsed;

        if (remaining <= 0) {
            clearInterval(interval);
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

        // Update session in database every 10 seconds
        if (elapsed % 10 === 0) {
            await supabase
                .from('user_mining_sessions')
                .update({ current_amount: currentAmount })
                .eq('id', session.id);
        }
    }, 1000);

    miningIntervals.push(interval);
}

// Start Plan Mining Display
function startPlanMining(session) {
    // Similar to free mining but shown in secondary area if free mining is active
    const hasFreeMining = activeFreeSession && !activeFreeSession.is_completed;
    
    if (hasFreeMining) {
        // Show in secondary mining area
        const secondaryMining = document.getElementById('secondaryMining');
        secondaryMining.classList.remove('hidden');
        
        const secondaryCard = document.getElementById('secondaryMiningCard');
        const secondaryName = document.getElementById('secondaryMiningName');
        const secondaryAmount = document.getElementById('secondaryMiningAmount');

        secondaryName.textContent = session.plans?.name || 'Plan Mining';

        // Calculate and update
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

            if (elapsed % 10 === 0) {
                await supabase
                    .from('user_mining_sessions')
                    .update({ current_amount: currentAmount })
                    .eq('id', session.id);
            }
        }, 1000);

        miningIntervals.push(interval);

        // Make clickable to switch
        secondaryCard.onclick = () => switchMiningDisplay('plan');
    } else {
        // Show in main area
        displayPlanMiningMain(session);
    }
}

// Display Plan Mining in Main Area
function displayPlanMiningMain(session) {
    const miningIcon = document.getElementById('miningIcon');
    const miningTypeName = document.getElementById('miningTypeName');
    const miningRate = document.getElementById('miningRate');
    const miningAmount = document.getElementById('miningAmount');
    const miningTimer = document.getElementById('miningTimer');
    const miningProgress = document.getElementById('miningProgress');

    miningTypeName.textContent = session.plans?.name || 'Plan Mining';
    miningProgress.classList.remove('hidden');
    miningIcon.classList.add('mining-active');

    // Load plan UI if available
    if (session.plans?.ui_url) {
        miningIcon.innerHTML = `<img src="${session.plans.ui_url}" alt="Plan">`;
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

        if (elapsed % 10 === 0) {
            await supabase
                .from('user_mining_sessions')
                .update({ current_amount: currentAmount })
                .eq('id', session.id);
        }
    }, 1000);

    miningIntervals.push(interval);
}

// Switch Mining Display
function switchMiningDisplay(type) {
    // Clear current display
    miningIntervals.forEach(interval => clearInterval(interval));
    miningIntervals = [];

    if (type === 'plan' && activePlanSession) {
        displayPlanMiningMain(activePlanSession);
        
        if (activeFreeSession) {
            // Show free in secondary
            const secondaryMining = document.getElementById('secondaryMining');
            secondaryMining.classList.remove('hidden');
            
            const secondaryName = document.getElementById('secondaryMiningName');
            secondaryName.textContent = 'Free Mining';
            
            // Restart free mining in secondary
            startFreeMining(activeFreeSession);
        }
    } else if (type === 'free' && activeFreeSession) {
        startFreeMining(activeFreeSession);
        
        if (activePlanSession) {
            startPlanMining(activePlanSession);
        }
    }
}

// Complete Mining Session
async function completeMiningSession(sessionId) {
    try {
        const { data: session } = await supabase
            .from('user_mining_sessions')
            .update({ 
                is_completed: true,
                current_amount: supabase.rpc('get_session_target', { session_id: sessionId })
            })
            .eq('id', sessionId)
            .select()
            .single();

        // Update user balance
        await updateUserBalance();
        
        showToast('Mining completed! ' + formatCurrency(session.target_amount) + ' MMK added to balance', 'success');

        // Reset display
        if (session.mining_type === 'free') {
            activeFreeSession = null;
            document.getElementById('startMiningBtn').style.display = 'inline-flex';
        } else {
            activePlanSession = null;
        }

        // Reload sessions
        await loadMiningeSessions();
    } catch (error) {
        console.error('Error completing mining:', error);
    }
}

// ======================================
// PLANS SYSTEM
// ======================================

// Load Plans
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

// Buy Plan
async function buyPlan(planId) {
    // Check if user already has an active plan
    const { data: activePurchase } = await supabase
        .from('user_plan_purchases')
        .select('*, user_mining_sessions!inner(*)')
        .eq('user_id', currentUser.id)
        .eq('status', 'approved')
        .eq('user_mining_sessions.is_completed', false)
        .single();

    if (activePurchase) {
        showToast('You already have an active plan. Complete it before buying a new one.', 'warning');
        return;
    }

    // Get plan details
    const { data: plan } = await supabase
        .from('plans')
        .select('*')
        .eq('id', planId)
        .single();

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
            <h4>Plan: ${plan.name}</h4>
            <p>Price: ${formatCurrency(plan.price)} MMK</p>
        </div>
        
        <h4 style="margin-bottom: 12px;">Select Payment Method:</h4>
        <div class="payment-options">
            ${payments.map(payment => `
                <div class="payment-option" data-payment-id="${payment.id}">
                    ${payment.icon_url ? `<img src="${payment.icon_url}" alt="${payment.name}">` : '<i class="fas fa-wallet"></i>'}
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
                <input type="text" id="transactionLast6" maxlength="6" pattern="[0-9A-Za-z]{6}" placeholder="Enter last 6 digits" required>
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
                <div class="payment-detail-item">
                    <label>Instructions:</label>
                    <p>${payment.instructions || 'Please transfer the exact amount and submit the transaction details.'}</p>
                </div>
                <div class="payment-detail-item">
                    <label>Amount to Pay:</label>
                    <p style="color: var(--primary-color); font-size: 20px; font-weight: bold;">${formatCurrency(plan.price)} MMK</p>
                </div>
            `;
            
            document.getElementById('paymentDetailsSection').classList.remove('hidden');
        };
    });
}

// Submit Plan Purchase
window.submitPlanPurchase = async function(planId) {
    const selectedPayment = document.querySelector('.payment-option.selected');
    if (!selectedPayment) {
        showToast('Please select a payment method', 'error');
        return;
    }

    const transactionLast6 = document.getElementById('transactionLast6').value;
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
                transaction_last_6: transactionLast6,
                status: 'pending'
            }])
            .select()
            .single();

        if (error) throw error;

        showToast('Purchase request submitted! Please wait for approval.', 'success');
        document.getElementById('planPurchaseModal').classList.remove('active');
        
        // Reload plans
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
        .select('*, plans(*), payments(*)')
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
        .order('created_at', { ascending: true });

    const container = document.getElementById('contactsContainer');
    
    if (!contacts || contacts.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-address-book"></i><p>No contacts available</p></div>';
        return;
    }

    container.innerHTML = contacts.map(contact => `
        <div class="contact-card" onclick="window.open('${contact.link}', '_blank')">
            ${contact.icon_url ? `<img src="${contact.icon_url}" alt="${contact.name}" class="contact-icon">` : '<i class="fas fa-link" style="font-size: 48px; color: var(--primary-color);"></i>'}
            <h3>${contact.name}</h3>
            <p>${contact.description || 'Click to contact'}</p>
        </div>
    `).join('');
}

// ======================================
// NEWS PAGE
// ======================================

async function loadNews() {
    const { data: news } = await supabase
        .from('news')
        .select('*, news_media(*)')
        .order('created_at', { ascending: false });

    const container = document.getElementById('newsContainer');
    
    if (!news || news.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-newspaper"></i><p>No news available</p></div>';
        return;
    }

    for (const item of news) {
        // Get contacts
        let contactsHTML = '';
        if (item.contact_ids && item.contact_ids.length > 0) {
            const { data: contacts } = await supabase
                .from('contacts')
                .select('*')
                .in('id', item.contact_ids);
            
            if (contacts && contacts.length > 0) {
                contactsHTML = `
                    <div class="news-contacts">
                        ${contacts.map(contact => `
                            <a href="${contact.link}" target="_blank" class="news-contact-btn">
                                ${contact.icon_url ? `<img src="${contact.icon_url}" class="news-contact-icon">` : ''}
                                ${contact.name}
                            </a>
                        `).join('')}
                    </div>
                `;
            }
        }

        // Get media
        let mediaHTML = '';
        if (item.news_media && item.news_media.length > 0) {
            const images = item.news_media.filter(m => m.media_type === 'image');
            const videos = item.news_media.filter(m => m.media_type === 'video');
            
            if (images.length === 1) {
                mediaHTML = `<img src="${images[0].media_url}" alt="News" class="news-media">`;
            } else if (images.length > 1) {
                mediaHTML = `
                    <div class="news-media-grid">
                        ${images.map(img => `<img src="${img.media_url}" alt="News" onclick="window.open('${img.media_url}', '_blank')">`).join('')}
                    </div>
                `;
            }
            
            if (videos.length > 0) {
                mediaHTML += `<video src="${videos[0].media_url}" controls class="news-video"></video>`;
            }
        }

        // YouTube video
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

        container.innerHTML += `
            <div class="news-card">
                ${mediaHTML}
                <div class="news-content">
                    <h3>${item.title}</h3>
                    <p>${item.content}</p>
                    ${contactsHTML}
                    <p class="news-date">${formatDate(item.created_at)}</p>
                </div>
            </div>
        `;
    }
}

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
                    <span>Date</span>
                    <span>${formatDate(withdrawal.requested_at)}</span>
                </div>
            </div>
        </div>
    `).join('');
}

// Update Profile
document.getElementById('updateProfileBtn')?.addEventListener('click', async () => {
    const newPassword = document.getElementById('profileNewPassword').value;
    const newPin = document.getElementById('profileNewPin').value;

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

        showToast('Profile updated successfully', 'success');
        
        // Clear inputs
        document.getElementById('profileNewPassword').value = '';
        document.getElementById('profileNewPin').value = '';
    } catch (error) {
        console.error('Error updating profile:', error);
        showToast('Failed to update profile', 'error');
    }
});

// Withdrawal Request
document.getElementById('withdrawBtn')?.addEventListener('click', () => {
    const modal = document.getElementById('withdrawalModal');
    document.getElementById('withdrawAvailableBalance').textContent = formatCurrency(currentUser.balance) + ' MMK';
    modal.classList.add('active');
});

document.getElementById('withdrawalForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const amount = parseFloat(document.getElementById('withdrawAmount').value);
    const paymentType = document.getElementById('withdrawPaymentType').value;
    const accountName = document.getElementById('withdrawAccountName').value;
    const paymentAddress = document.getElementById('withdrawPaymentAddress').value;
    const pin = document.getElementById('withdrawPin').value;

    // Verify PIN
    if (pin !== currentUser.withdraw_pin) {
        showToast('Invalid withdrawal PIN', 'error');
        return;
    }

    // Check limits
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
    const username = document.getElementById('regUsername').value;
    const password = document.getElementById('regPassword').value;
    const pin = document.getElementById('regPin').value;
    
    await registerUser(username, password, pin);
});

// Login Form
document.getElementById('loginFormElement')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value;
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
document.getElementById('startMiningBtn')?.addEventListener('click', startFreeMiningSession);

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
        // Get user IP
        userIP = await getUserIP();
        
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
    } catch (error) {
        console.error('Initialization error:', error);
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
});
