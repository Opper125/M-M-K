/* ======================================
   MY MMK - Admin Dashboard JavaScript
   ====================================== */

// Supabase Configuration
const SUPABASE_URL = 'https://qmeeqwdnjlmhjuexldsu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtZWVxd2RuamxtaGp1ZXhsZHN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4Mzg3MDYsImV4cCI6MjA3NTQxNDcwNn0.tyL8-OQByO7MALrBJCZ6rNZ0oR10DWSJ3776nHBgn7Q';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Global State
let adminIP = null;
let adminAuthorized = false;
let currentEditId = null;
let allContacts = [];
let loginRequestInterval = null;

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
        let deviceId = localStorage.getItem('admin_device_id');
        if (!deviceId) {
            deviceId = 'admin_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('admin_device_id', deviceId);
        }
        return deviceId;
    }
}

async function getBrowserInfo() {
    return {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        screenResolution: `${screen.width}x${screen.height}`
    };
}

// File Upload to Supabase Storage
async function uploadFile(file, bucket) {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExt}`;
    const filePath = `${fileName}`;

    const { data, error } = await supabase.storage
        .from(bucket)
        .upload(filePath, file);

    if (error) throw error;

    const { data: urlData } = supabase.storage
        .from(bucket)
        .getPublicUrl(filePath);

    return urlData.publicUrl;
}

// Delete File from Supabase Storage
async function deleteFile(url, bucket) {
    try {
        const fileName = url.split('/').pop();
        await supabase.storage.from(bucket).remove([fileName]);
    } catch (error) {
        console.error('Error deleting file:', error);
    }
}

// ======================================
// ADMIN AUTHENTICATION
// ======================================

async function checkAdminAuth() {
    adminIP = await getUserIP();
    
    // Check if this IP is banned
    const { data: banned } = await supabase
        .from('banned_ips')
        .select('*')
        .eq('ip_address', adminIP)
        .single();
    
    if (banned) {
        document.body.innerHTML = `
            <div style="display:flex;justify-content:center;align-items:center;height:100vh;background:#0f172a;color:#f1f5f9;text-align:center;padding:20px;">
                <div>
                    <i class="fas fa-ban" style="font-size:72px;color:#ef4444;margin-bottom:20px;"></i>
                    <h1 style="font-size:32px;margin-bottom:16px;">Access Permanently Denied</h1>
                    <p style="color:#94a3b8;font-size:18px;">This device has been banned from admin access.</p>
                </div>
            </div>
        `;
        return;
    }

    // Check if IP is authorized and logged in
    const savedAuth = localStorage.getItem('admin_authorized');
    if (savedAuth) {
        const { data: auth } = await supabase
            .from('admin_auth')
            .select('*')
            .eq('authorized_ip', adminIP)
            .eq('is_active', true)
            .single();

        if (auth) {
            adminAuthorized = true;
            showDashboard();
            return;
        }
    }

    // Show login form
    document.getElementById('adminLogin').classList.remove('hidden');
}

// Admin Login
document.getElementById('adminLoginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const password = document.getElementById('adminPassword').value;
    
    try {
        // Check if password exists and matches authorized IP
        const { data: auth, error } = await supabase
            .from('admin_auth')
            .select('*')
            .eq('password', password)
            .eq('is_active', true)
            .single();

        if (error || !auth) {
            showToast('Invalid admin password', 'error');
            return;
        }

        // Check if IP matches
        if (auth.authorized_ip === adminIP) {
            // Direct login
            adminAuthorized = true;
            localStorage.setItem('admin_authorized', 'true');
            showToast('Login successful!', 'success');
            document.getElementById('adminLogin').classList.add('hidden');
            showDashboard();
        } else {
            // Request approval from authorized device
            const browserInfo = await getBrowserInfo();
            
            const { error: reqError } = await supabase
                .from('admin_login_requests')
                .insert([{
                    ip_address: adminIP,
                    browser_info: JSON.stringify(browserInfo),
                    location: 'Unknown',
                    status: 'pending'
                }]);

            if (reqError) throw reqError;

            showToast('Login request sent. Waiting for approval...', 'warning');
            document.getElementById('loginRequestInfo').classList.remove('hidden');
            
            // Start polling for approval
            startLoginRequestPolling();
        }
    } catch (error) {
        console.error('Login error:', error);
        showToast('Login failed: ' + error.message, 'error');
    }
});

// Poll for login request approval
function startLoginRequestPolling() {
    loginRequestInterval = setInterval(async () => {
        const { data } = await supabase
            .from('admin_login_requests')
            .select('*')
            .eq('ip_address', adminIP)
            .eq('status', 'approved')
            .order('requested_at', { ascending: false })
            .limit(1)
            .single();

        if (data) {
            clearInterval(loginRequestInterval);
            adminAuthorized = true;
            localStorage.setItem('admin_authorized', 'true');
            showToast('Login approved!', 'success');
            document.getElementById('adminLogin').classList.add('hidden');
            showDashboard();
        }

        // Check if rejected
        const { data: rejected } = await supabase
            .from('admin_login_requests')
            .select('*')
            .eq('ip_address', adminIP)
            .eq('status', 'rejected')
            .order('requested_at', { ascending: false })
            .limit(1)
            .single();

        if (rejected) {
            clearInterval(loginRequestInterval);
            
            // Ban this IP
            await supabase
                .from('banned_ips')
                .insert([{
                    ip_address: adminIP,
                    reason: 'Admin login rejected'
                }]);

            showToast('Login rejected. This device has been banned.', 'error');
            
            setTimeout(() => {
                location.reload();
            }, 2000);
        }
    }, 3000); // Check every 3 seconds
}

// ======================================
// DASHBOARD DISPLAY
// ======================================

function showDashboard() {
    document.getElementById('adminDashboard').classList.remove('hidden');
    loadDashboardStats();
    loadLoginRequests();
    loadSiteSettings();
    showSection('dashboard');
}

function showSection(sectionId) {
    // Hide all sections
    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.remove('active');
    });

    // Show selected section
    document.getElementById(sectionId + 'Section').classList.add('active');

    // Update navigation
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
    });
    document.querySelector(`[data-section="${sectionId}"]`).classList.add('active');

    // Load section data
    switch(sectionId) {
        case 'dashboard':
            loadDashboardStats();
            break;
        case 'loginRequests':
            loadLoginRequests();
            break;
        case 'settings':
            loadSiteSettings();
            break;
        case 'miningUI':
            loadMiningUI();
            break;
        case 'freeMining':
            loadFreeMiningSettings();
            break;
        case 'plans':
            loadPlans();
            break;
        case 'payments':
            loadPayments();
            break;
        case 'contacts':
            loadContacts();
            break;
        case 'news':
            loadNews();
            break;
        case 'users':
            loadUsers();
            break;
        case 'purchases':
            loadPurchases();
            break;
        case 'withdrawals':
            loadWithdrawals();
            break;
    }
}

// Navigation
document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const section = link.dataset.section;
        showSection(section);
    });
});

// ======================================
// DASHBOARD STATS
// ======================================

async function loadDashboardStats() {
    try {
        // Total Users
        const { count: usersCount } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true });
        document.getElementById('totalUsers').textContent = formatCurrency(usersCount || 0);

        // Active Plans
        const { count: plansCount } = await supabase
            .from('user_mining_sessions')
            .select('*', { count: 'exact', head: true })
            .eq('mining_type', 'plan')
            .eq('is_completed', false);
        document.getElementById('activePlans').textContent = formatCurrency(plansCount || 0);

        // Total Mined
        const { data: totalMined } = await supabase
            .from('users')
            .select('total_coins');
        const total = totalMined?.reduce((sum, user) => sum + parseFloat(user.total_coins || 0), 0) || 0;
        document.getElementById('totalMined').textContent = formatCurrency(total);

        // Total Revenue
        const { data: purchases } = await supabase
            .from('user_plan_purchases')
            .select('plans(price)')
            .eq('status', 'approved');
        const revenue = purchases?.reduce((sum, p) => sum + parseFloat(p.plans?.price || 0), 0) || 0;
        document.getElementById('totalRevenue').textContent = formatCurrency(revenue);

        // Recent Activities
        loadRecentActivities();

        // Pending Actions
        loadPendingActions();
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

async function loadRecentActivities() {
    const container = document.getElementById('recentActivities');
    
    const { data: activities } = await supabase
        .from('user_plan_purchases')
        .select('*, users(username), plans(name)')
        .order('purchased_at', { ascending: false })
        .limit(10);

    if (!activities || activities.length === 0) {
        container.innerHTML = '<p class="text-muted">No recent activities</p>';
        return;
    }

    container.innerHTML = activities.map(activity => `
        <div class="activity-item">
            <strong>${activity.users?.username}</strong> purchased 
            <strong>${activity.plans?.name}</strong> - 
            <span class="status-badge ${activity.status}">${activity.status}</span>
            <br>
            <small>${formatDate(activity.purchased_at)}</small>
        </div>
    `).join('');
}

async function loadPendingActions() {
    const container = document.getElementById('pendingActions');
    
    // Count pending items
    const { count: purchasesCount } = await supabase
        .from('user_plan_purchases')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

    const { count: withdrawalsCount } = await supabase
        .from('withdrawal_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

    const { count: loginRequestsCount } = await supabase
        .from('admin_login_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

    // Update badges
    document.getElementById('purchasesBadge').textContent = purchasesCount || 0;
    document.getElementById('withdrawalsBadge').textContent = withdrawalsCount || 0;
    document.getElementById('requestsBadge').textContent = loginRequestsCount || 0;

    container.innerHTML = `
        <div class="pending-item">
            <i class="fas fa-shopping-cart"></i> 
            <strong>${purchasesCount || 0}</strong> pending plan purchases
        </div>
        <div class="pending-item">
            <i class="fas fa-money-bill-wave"></i> 
            <strong>${withdrawalsCount || 0}</strong> pending withdrawals
        </div>
        <div class="pending-item">
            <i class="fas fa-user-check"></i> 
            <strong>${loginRequestsCount || 0}</strong> pending login requests
        </div>
    `;
}

// ======================================
// LOGIN REQUESTS MANAGEMENT
// ======================================

async function loadLoginRequests() {
    const { data: requests } = await supabase
        .from('admin_login_requests')
        .select('*')
        .order('requested_at', { ascending: false });

    const tbody = document.getElementById('loginRequestsTable');
    
    if (!requests || requests.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No login requests</td></tr>';
        return;
    }

    tbody.innerHTML = requests.map(req => `
        <tr>
            <td>${req.ip_address}</td>
            <td>${req.browser_info ? JSON.parse(req.browser_info).userAgent.substring(0, 50) + '...' : 'N/A'}</td>
            <td>${req.location || 'Unknown'}</td>
            <td>${formatDate(req.requested_at)}</td>
            <td><span class="status-badge ${req.status}">${req.status}</span></td>
            <td>
                ${req.status === 'pending' ? `
                    <button class="btn-success btn-icon" onclick="approveLoginRequest('${req.id}', '${req.ip_address}')">
                        <i class="fas fa-check"></i>
                    </button>
                    <button class="btn-danger btn-icon" onclick="rejectLoginRequest('${req.id}', '${req.ip_address}')">
                        <i class="fas fa-times"></i>
                    </button>
                ` : '-'}
            </td>
        </tr>
    `).join('');
}

window.approveLoginRequest = async function(id, ip) {
    try {
        await supabase
            .from('admin_login_requests')
            .update({ status: 'approved' })
            .eq('id', id);

        showToast('Login request approved', 'success');
        loadLoginRequests();
        loadPendingActions();
    } catch (error) {
        showToast('Error approving request', 'error');
    }
};

window.rejectLoginRequest = async function(id, ip) {
    if (!confirm('Are you sure you want to reject this request? This will ban the IP address.')) return;

    try {
        // Update request status
        await supabase
            .from('admin_login_requests')
            .update({ status: 'rejected' })
            .eq('id', id);

        // Ban IP
        await supabase
            .from('banned_ips')
            .insert([{
                ip_address: ip,
                reason: 'Admin login request rejected'
            }]);

        showToast('Login request rejected and IP banned', 'success');
        loadLoginRequests();
        loadPendingActions();
    } catch (error) {
        showToast('Error rejecting request', 'error');
    }
};

// ======================================
// SITE SETTINGS
// ======================================

async function loadSiteSettings() {
    const { data: settings } = await supabase
        .from('site_settings')
        .select('*')
        .single();

    if (settings) {
        document.getElementById('siteName').value = settings.site_name || 'MY MMK';
        
        if (settings.logo_url) {
            document.getElementById('logoPreview').innerHTML = `
                <img src="${settings.logo_url}" alt="Logo">
            `;
        }
    }
}

// Logo Upload
document.getElementById('logoUpload')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
        showToast('Uploading logo...', 'warning');
        
        const url = await uploadFile(file, 'logos');
        
        // Update database
        const { data: settings } = await supabase
            .from('site_settings')
            .select('*')
            .single();

        if (settings) {
            // Delete old logo if exists
            if (settings.logo_url) {
                await deleteFile(settings.logo_url, 'logos');
            }

            await supabase
                .from('site_settings')
                .update({ logo_url: url })
                .eq('id', settings.id);
        } else {
            await supabase
                .from('site_settings')
                .insert([{ logo_url: url }]);
        }

        showToast('Logo uploaded successfully!', 'success');
        loadSiteSettings();
    } catch (error) {
        console.error('Error uploading logo:', error);
        showToast('Failed to upload logo', 'error');
    }
});

// Update Site Name
window.updateSiteName = async function() {
    const siteName = document.getElementById('siteName').value;
    
    try {
        const { data: settings } = await supabase
            .from('site_settings')
            .select('*')
            .single();

        if (settings) {
            await supabase
                .from('site_settings')
                .update({ site_name: siteName })
                .eq('id', settings.id);
        } else {
            await supabase
                .from('site_settings')
                .insert([{ site_name: siteName }]);
        }

        showToast('Site name updated!', 'success');
    } catch (error) {
        showToast('Failed to update site name', 'error');
    }
};

// Create Admin Auth
window.createAdminAuth = async function() {
    const password = document.getElementById('newAdminPassword').value;
    const authorizedIP = document.getElementById('authorizedIP').value;

    if (!password || !authorizedIP) {
        showToast('Please fill all fields', 'error');
        return;
    }

    try {
        await supabase
            .from('admin_auth')
            .insert([{
                password: password,
                authorized_ip: authorizedIP,
                is_active: true
            }]);

        showToast('Admin access created successfully!', 'success');
        document.getElementById('newAdminPassword').value = '';
        document.getElementById('authorizedIP').value = '';
    } catch (error) {
        showToast('Failed to create admin access: ' + error.message, 'error');
    }
};

// ======================================
// MINING UI
// ======================================

async function loadMiningUI() {
    const { data: ui } = await supabase
        .from('mining_ui')
        .select('*')
        .eq('is_active', true)
        .single();

    if (ui && ui.ui_url) {
        document.getElementById('miningUIPreview').innerHTML = `
            <img src="${ui.ui_url}" alt="Mining UI">
        `;
    }
}

document.getElementById('miningUIUpload')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
        showToast('Uploading mining UI...', 'warning');
        
        const url = await uploadFile(file, 'mining-ui');
        
        // Deactivate old UI
        await supabase
            .from('mining_ui')
            .update({ is_active: false })
            .eq('is_active', true);

        // Insert new UI
        await supabase
            .from('mining_ui')
            .insert([{
                ui_url: url,
                is_active: true
            }]);

        showToast('Mining UI uploaded successfully!', 'success');
        loadMiningUI();
    } catch (error) {
        console.error('Error uploading mining UI:', error);
        showToast('Failed to upload mining UI', 'error');
    }
});

// ======================================
// FREE MINING SETTINGS
// ======================================

async function loadFreeMiningSettings() {
    const { data: settings } = await supabase
        .from('free_mining_settings')
        .select('*')
        .order('created_at', { ascending: false });

    const container = document.getElementById('freeMiningList');
    
    if (!settings || settings.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-clock"></i><p>No free mining settings</p></div>';
        return;
    }

    container.innerHTML = settings.map(setting => `
        <div class="list-card">
            <div class="list-card-header">
                <h3>Free Mining</h3>
                <div class="list-card-actions">
                    <button class="btn-danger btn-icon" onclick="deleteFreeMining('${setting.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            <div class="list-card-body">
                <p><strong>Time:</strong> ${setting.start_time} - ${setting.end_time}</p>
                <p><strong>Amount:</strong> ${formatCurrency(setting.amount)} MMK</p>
                <p><strong>Status:</strong> <span class="status-badge ${setting.is_active ? 'approved' : 'rejected'}">${setting.is_active ? 'Active' : 'Inactive'}</span></p>
            </div>
        </div>
    `).join('');
}

window.showAddFreeMining = function() {
    document.getElementById('freeMiningForm').reset();
    document.getElementById('freeMiningModal').classList.add('active');
};

document.getElementById('freeMiningForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const startTime = document.getElementById('freeStartTime').value;
    const endTime = document.getElementById('freeEndTime').value;
    const amount = parseFloat(document.getElementById('freeAmount').value);

    try {
        // Deactivate all existing settings
        await supabase
            .from('free_mining_settings')
            .update({ is_active: false })
            .eq('is_active', true);

        // Insert new setting
        await supabase
            .from('free_mining_settings')
            .insert([{
                start_time: startTime,
                end_time: endTime,
                amount: amount,
                is_active: true
            }]);

        showToast('Free mining setting added!', 'success');
        document.getElementById('freeMiningModal').classList.remove('active');
        loadFreeMiningSettings();
    } catch (error) {
        showToast('Failed to add setting', 'error');
    }
});

window.deleteFreeMining = async function(id) {
    if (!confirm('Are you sure you want to delete this setting?')) return;

    try {
        await supabase
            .from('free_mining_settings')
            .delete()
            .eq('id', id);

        showToast('Setting deleted', 'success');
        loadFreeMiningSettings();
    } catch (error) {
        showToast('Failed to delete setting', 'error');
    }
};

// ======================================
// PLANS MANAGEMENT
// ======================================

async function loadPlans() {
    const { data: plans } = await supabase
        .from('plans')
        .select('*')
        .order('price', { ascending: true });

    const container = document.getElementById('plansList');
    
    if (!plans || plans.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-gem"></i><p>No plans created</p></div>';
        return;
    }

    container.innerHTML = plans.map(plan => `
        <div class="list-card">
            ${plan.ui_url ? `<img src="${plan.ui_url}" style="width:100%;height:150px;object-fit:cover;border-radius:12px;margin-bottom:12px;">` : ''}
            <div class="list-card-header">
                <h3>${plan.name}</h3>
                <div class="list-card-actions">
                    <button class="btn-secondary btn-icon" onclick="editPlan('${plan.id}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-danger btn-icon" onclick="deletePlan('${plan.id}', '${plan.ui_url || ''}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            <div class="list-card-body">
                <p><strong>Duration:</strong> ${plan.duration_hours} hours</p>
                <p><strong>Mining Amount:</strong> ${formatCurrency(plan.total_amount)} MMK</p>
                <p><strong>Price:</strong> ${formatCurrency(plan.price)} MMK</p>
                <p><strong>Status:</strong> <span class="status-badge ${plan.is_active ? 'approved' : 'rejected'}">${plan.is_active ? 'Active' : 'Inactive'}</span></p>
            </div>
        </div>
    `).join('');
}

window.showAddPlan = function() {
    currentEditId = null;
    document.getElementById('planForm').reset();
    document.getElementById('planId').value = '';
    document.getElementById('planModalTitle').textContent = 'Add Plan';
    document.getElementById('planImagePreview').innerHTML = '';
    document.getElementById('planModal').classList.add('active');
};

window.editPlan = async function(id) {
    currentEditId = id;
    const { data: plan } = await supabase
        .from('plans')
        .select('*')
        .eq('id', id)
        .single();

    if (plan) {
        document.getElementById('planId').value = plan.id;
        document.getElementById('planName').value = plan.name;
        document.getElementById('planDuration').value = plan.duration_hours;
        document.getElementById('planAmount').value = plan.total_amount;
        document.getElementById('planPrice').value = plan.price;
        
        if (plan.ui_url) {
            document.getElementById('planImagePreview').innerHTML = `<img src="${plan.ui_url}" style="max-width:100%;max-height:200px;">`;
        }
        
        document.getElementById('planModalTitle').textContent = 'Edit Plan';
        document.getElementById('planModal').classList.add('active');
    }
};

document.getElementById('planForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = document.getElementById('planId').value;
    const name = document.getElementById('planName').value;
    const duration = parseInt(document.getElementById('planDuration').value);
    const amount = parseFloat(document.getElementById('planAmount').value);
    const price = parseFloat(document.getElementById('planPrice').value);
    const imageFile = document.getElementById('planImage').files[0];

    try {
        let uiUrl = null;
        
        if (imageFile) {
            showToast('Uploading image...', 'warning');
            uiUrl = await uploadFile(imageFile, 'plan-images');
        }

        const planData = {
            name,
            duration_hours: duration,
            total_amount: amount,
            price,
            is_active: true
        };

        if (uiUrl) {
            planData.ui_url = uiUrl;
        }

        if (id) {
            // Update existing plan
            const { data: oldPlan } = await supabase
                .from('plans')
                .select('ui_url')
                .eq('id', id)
                .single();

            if (uiUrl && oldPlan?.ui_url) {
                await deleteFile(oldPlan.ui_url, 'plan-images');
            }

            await supabase
                .from('plans')
                .update(planData)
                .eq('id', id);

            showToast('Plan updated!', 'success');
        } else {
            // Create new plan
            await supabase
                .from('plans')
                .insert([planData]);

            showToast('Plan created!', 'success');
        }

        document.getElementById('planModal').classList.remove('active');
        loadPlans();
    } catch (error) {
        console.error('Error saving plan:', error);
        showToast('Failed to save plan', 'error');
    }
});

window.deletePlan = async function(id, uiUrl) {
    if (!confirm('Are you sure you want to delete this plan?')) return;

    try {
        if (uiUrl) {
            await deleteFile(uiUrl, 'plan-images');
        }

        await supabase
            .from('plans')
            .delete()
            .eq('id', id);

        showToast('Plan deleted', 'success');
        loadPlans();
    } catch (error) {
        showToast('Failed to delete plan', 'error');
    }
};

// ======================================
// PAYMENTS MANAGEMENT
// ======================================

async function loadPayments() {
    const { data: payments } = await supabase
        .from('payments')
        .select('*')
        .order('created_at', { ascending: true });

    const container = document.getElementById('paymentsList');
    
    if (!payments || payments.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-credit-card"></i><p>No payment methods</p></div>';
        return;
    }

    container.innerHTML = payments.map(payment => `
        <div class="list-card">
            ${payment.icon_url ? `<img src="${payment.icon_url}" style="width:80px;height:80px;object-fit:cover;border-radius:12px;margin-bottom:12px;">` : ''}
            <div class="list-card-header">
                <h3>${payment.name}</h3>
                <div class="list-card-actions">
                    <button class="btn-secondary btn-icon" onclick="editPayment('${payment.id}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-danger btn-icon" onclick="deletePayment('${payment.id}', '${payment.icon_url || ''}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            <div class="list-card-body">
                <p><strong>Address:</strong> ${payment.address}</p>
                <p><strong>Instructions:</strong> ${payment.instructions || 'N/A'}</p>
                <p><strong>Status:</strong> <span class="status-badge ${payment.is_active ? 'approved' : 'rejected'}">${payment.is_active ? 'Active' : 'Inactive'}</span></p>
            </div>
        </div>
    `).join('');
}

window.showAddPayment = function() {
    currentEditId = null;
    document.getElementById('paymentForm').reset();
    document.getElementById('paymentId').value = '';
    document.getElementById('paymentModalTitle').textContent = 'Add Payment';
    document.getElementById('paymentIconPreview').innerHTML = '';
    document.getElementById('paymentModal').classList.add('active');
};

window.editPayment = async function(id) {
    currentEditId = id;
    const { data: payment } = await supabase
        .from('payments')
        .select('*')
        .eq('id', id)
        .single();

    if (payment) {
        document.getElementById('paymentId').value = payment.id;
        document.getElementById('paymentName').value = payment.name;
        document.getElementById('paymentAddress').value = payment.address;
        document.getElementById('paymentInstructions').value = payment.instructions || '';
        
        if (payment.icon_url) {
            document.getElementById('paymentIconPreview').innerHTML = `<img src="${payment.icon_url}" style="max-width:100px;">`;
        }
        
        document.getElementById('paymentModalTitle').textContent = 'Edit Payment';
        document.getElementById('paymentModal').classList.add('active');
    }
};

document.getElementById('paymentForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = document.getElementById('paymentId').value;
    const name = document.getElementById('paymentName').value;
    const address = document.getElementById('paymentAddress').value;
    const instructions = document.getElementById('paymentInstructions').value;
    const iconFile = document.getElementById('paymentIcon').files[0];

    try {
        let iconUrl = null;
        
        if (iconFile) {
            showToast('Uploading icon...', 'warning');
            iconUrl = await uploadFile(iconFile, 'payment-icons');
        }

        const paymentData = {
            name,
            address,
            instructions,
            is_active: true
        };

        if (iconUrl) {
            paymentData.icon_url = iconUrl;
        }

        if (id) {
            const { data: oldPayment } = await supabase
                .from('payments')
                .select('icon_url')
                .eq('id', id)
                .single();

            if (iconUrl && oldPayment?.icon_url) {
                await deleteFile(oldPayment.icon_url, 'payment-icons');
            }

            await supabase
                .from('payments')
                .update(paymentData)
                .eq('id', id);

            showToast('Payment updated!', 'success');
        } else {
            await supabase
                .from('payments')
                .insert([paymentData]);

            showToast('Payment created!', 'success');
        }

        document.getElementById('paymentModal').classList.remove('active');
        loadPayments();
    } catch (error) {
        console.error('Error saving payment:', error);
        showToast('Failed to save payment', 'error');
    }
});

window.deletePayment = async function(id, iconUrl) {
    if (!confirm('Are you sure you want to delete this payment method?')) return;

    try {
        if (iconUrl) {
            await deleteFile(iconUrl, 'payment-icons');
        }

        await supabase
            .from('payments')
            .delete()
            .eq('id', id);

        showToast('Payment deleted', 'success');
        loadPayments();
    } catch (error) {
        showToast('Failed to delete payment', 'error');
    }
};

// ======================================
// CONTACTS MANAGEMENT
// ======================================

async function loadContacts() {
    const { data: contacts } = await supabase
        .from('contacts')
        .select('*')
        .order('created_at', { ascending: true });

    allContacts = contacts || [];
    const container = document.getElementById('contactsList');
    
    if (!contacts || contacts.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-address-book"></i><p>No contacts</p></div>';
        return;
    }

    container.innerHTML = contacts.map(contact => `
        <div class="list-card">
            ${contact.icon_url ? `<img src="${contact.icon_url}" style="width:60px;height:60px;object-fit:cover;border-radius:12px;margin-bottom:12px;">` : ''}
            <div class="list-card-header">
                <h3>${contact.name}</h3>
                <div class="list-card-actions">
                    <button class="btn-secondary btn-icon" onclick="editContact('${contact.id}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-danger btn-icon" onclick="deleteContact('${contact.id}', '${contact.icon_url || ''}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            <div class="list-card-body">
                <p><strong>Link:</strong> <a href="${contact.link}" target="_blank">${contact.link.substring(0, 50)}...</a></p>
                <p><strong>Description:</strong> ${contact.description || 'N/A'}</p>
            </div>
        </div>
    `).join('');
}

window.showAddContact = function() {
    currentEditId = null;
    document.getElementById('contactForm').reset();
    document.getElementById('contactId').value = '';
    document.getElementById('contactModalTitle').textContent = 'Add Contact';
    document.getElementById('contactIconPreview').innerHTML = '';
    document.getElementById('contactModal').classList.add('active');
};

window.editContact = async function(id) {
    currentEditId = id;
    const { data: contact } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', id)
        .single();

    if (contact) {
        document.getElementById('contactId').value = contact.id;
        document.getElementById('contactName').value = contact.name;
        document.getElementById('contactLink').value = contact.link;
        document.getElementById('contactDescription').value = contact.description || '';
        
        if (contact.icon_url) {
            document.getElementById('contactIconPreview').innerHTML = `<img src="${contact.icon_url}" style="max-width:100px;">`;
        }
        
        document.getElementById('contactModalTitle').textContent = 'Edit Contact';
        document.getElementById('contactModal').classList.add('active');
    }
};

document.getElementById('contactForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = document.getElementById('contactId').value;
    const name = document.getElementById('contactName').value;
    const link = document.getElementById('contactLink').value;
    const description = document.getElementById('contactDescription').value;
    const iconFile = document.getElementById('contactIcon').files[0];

    try {
        let iconUrl = null;
        
        if (iconFile) {
            showToast('Uploading icon...', 'warning');
            iconUrl = await uploadFile(iconFile, 'contact-icons');
        }

        const contactData = {
            name,
            link,
            description,
            is_active: true
        };

        if (iconUrl) {
            contactData.icon_url = iconUrl;
        }

        if (id) {
            const { data: oldContact } = await supabase
                .from('contacts')
                .select('icon_url')
                .eq('id', id)
                .single();

            if (iconUrl && oldContact?.icon_url) {
                await deleteFile(oldContact.icon_url, 'contact-icons');
            }

            await supabase
                .from('contacts')
                .update(contactData)
                .eq('id', id);

            showToast('Contact updated!', 'success');
        } else {
            await supabase
                .from('contacts')
                .insert([contactData]);

            showToast('Contact created!', 'success');
        }

        document.getElementById('contactModal').classList.remove('active');
        loadContacts();
    } catch (error) {
        console.error('Error saving contact:', error);
        showToast('Failed to save contact', 'error');
    }
});

window.deleteContact = async function(id, iconUrl) {
    if (!confirm('Are you sure you want to delete this contact?')) return;

    try {
        if (iconUrl) {
            await deleteFile(iconUrl, 'contact-icons');
        }

        await supabase
            .from('contacts')
            .delete()
            .eq('id', id);

        showToast('Contact deleted', 'success');
        loadContacts();
    } catch (error) {
        showToast('Failed to delete contact', 'error');
    }
};

// ======================================
// NEWS MANAGEMENT
// ======================================

async function loadNews() {
    const { data: news } = await supabase
        .from('news')
        .select('*, news_media(*)')
        .order('created_at', { ascending: false });

    const container = document.getElementById('newsList');
    
    if (!news || news.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-newspaper"></i><p>No news published</p></div>';
        return;
    }

    container.innerHTML = news.map(item => `
        <div class="list-card" style="margin-bottom:20px;">
            <div class="list-card-header">
                <h3>${item.title}</h3>
                <div class="list-card-actions">
                    <button class="btn-danger btn-icon" onclick="deleteNews('${item.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            <div class="list-card-body">
                <p>${item.content.substring(0, 150)}...</p>
                ${item.news_media && item.news_media.length > 0 ? `<p><strong>Media:</strong> ${item.news_media.length} files</p>` : ''}
                ${item.youtube_url ? `<p><strong>YouTube:</strong> Yes</p>` : ''}
                <p><small>${formatDate(item.created_at)}</small></p>
            </div>
        </div>
    `).join('');
}

window.showAddNews = async function() {
    currentEditId = null;
    document.getElementById('newsForm').reset();
    document.getElementById('newsId').value = '';
    document.getElementById('newsModalTitle').textContent = 'Add News';
    document.getElementById('newsImagesPreview').innerHTML = '';
    document.getElementById('newsVideoPreview').innerHTML = '';
    document.getElementById('imagesSizeInfo').textContent = '0 MB';
    document.getElementById('videoSizeInfo').textContent = '0 MB';
    
    // Load contacts for selection
    await loadContacts();
    const contactsSelect = document.getElementById('newsContactsSelect');
    contactsSelect.innerHTML = allContacts.map(contact => `
        <div class="checkbox-item">
            <input type="checkbox" id="contact_${contact.id}" value="${contact.id}">
            <label for="contact_${contact.id}">${contact.name}</label>
        </div>
    `).join('');
    
    document.getElementById('newsModal').classList.add('active');
};

// Image files validation and preview
document.getElementById('newsImages')?.addEventListener('change', function(e) {
    const files = Array.from(e.target.files);
    const maxSizePerImage = 10 * 1024 * 1024; // 10MB
    const maxTotalSize = 50 * 1024 * 1024; // 50MB
    
    let totalSize = 0;
    let validFiles = [];
    const preview = document.getElementById('newsImagesPreview');
    preview.innerHTML = '';
    
    files.forEach((file, index) => {
        const fileSize = file.size;
        totalSize += fileSize;
        
        const isValid = fileSize <= maxSizePerImage && totalSize <= maxTotalSize;
        
        const reader = new FileReader();
        reader.onload = function(event) {
            const div = document.createElement('div');
            div.className = `image-preview-item ${isValid ? 'valid' : 'invalid'}`;
            div.innerHTML = `
                <img src="${event.target.result}">
                ${!isValid ? `<button type="button" class="remove-btn" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button>` : ''}
            `;
            preview.appendChild(div);
        };
        reader.readAsDataURL(file);
        
        if (isValid) {
            validFiles.push(file);
        }
    });
    
    document.getElementById('imagesSizeInfo').textContent = (totalSize / 1024 / 1024).toFixed(2) + ' MB';
    
    if (totalSize > maxTotalSize) {
        showToast('Total images size exceeds 50MB. Remove some images.', 'warning');
    }
});

// Video file validation and preview
document.getElementById('newsVideo')?.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const maxSize = 50 * 1024 * 1024; // 50MB
    const preview = document.getElementById('newsVideoPreview');
    
    document.getElementById('videoSizeInfo').textContent = (file.size / 1024 / 1024).toFixed(2) + ' MB';
    
    if (file.size > maxSize) {
        showToast('Video size exceeds 50MB', 'error');
        e.target.value = '';
        preview.innerHTML = '';
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(event) {
        preview.innerHTML = `<video src="${event.target.result}" controls></video>`;
    };
    reader.readAsDataURL(file);
});

document.getElementById('newsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const title = document.getElementById('newsTitle').value;
    const content = document.getElementById('newsContent').value;
    const youtubeUrl = document.getElementById('newsYoutubeUrl').value;
    const imageFiles = Array.from(document.getElementById('newsImages').files);
    const videoFile = document.getElementById('newsVideo').files[0];
    
    // Get selected contacts
    const selectedContacts = Array.from(document.querySelectorAll('#newsContactsSelect input:checked'))
        .map(input => input.value);

    try {
        showToast('Publishing news...', 'warning');
        
        // Create news entry
        const { data: newsData, error: newsError } = await supabase
            .from('news')
            .insert([{
                title,
                content,
                youtube_url: youtubeUrl || null,
                contact_ids: selectedContacts.length > 0 ? selectedContacts : null
            }])
            .select()
            .single();

        if (newsError) throw newsError;

        // Upload images
        for (const imageFile of imageFiles) {
            if (imageFile.size <= 10 * 1024 * 1024) { // Max 10MB per image
                const url = await uploadFile(imageFile, 'news-media');
                await supabase
                    .from('news_media')
                    .insert([{
                        news_id: newsData.id,
                        media_url: url,
                        media_type: 'image',
                        file_size: imageFile.size
                    }]);
            }
        }

        // Upload video
        if (videoFile && videoFile.size <= 50 * 1024 * 1024) { // Max 50MB
            const url = await uploadFile(videoFile, 'news-media');
            await supabase
                .from('news_media')
                .insert([{
                    news_id: newsData.id,
                    media_url: url,
                    media_type: 'video',
                    file_size: videoFile.size
                }]);
        }

        showToast('News published successfully!', 'success');
        document.getElementById('newsModal').classList.remove('active');
        loadNews();
    } catch (error) {
        console.error('Error publishing news:', error);
        showToast('Failed to publish news', 'error');
    }
});

window.deleteNews = async function(id) {
    if (!confirm('Are you sure you want to delete this news?')) return;

    try {
        // Get media files
        const { data: media } = await supabase
            .from('news_media')
            .select('*')
            .eq('news_id', id);

        // Delete media files from storage
        if (media) {
            for (const item of media) {
                await deleteFile(item.media_url, 'news-media');
            }
        }

        // Delete news (cascade will delete media records)
        await supabase
            .from('news')
            .delete()
            .eq('id', id);

        showToast('News deleted', 'success');
        loadNews();
    } catch (error) {
        showToast('Failed to delete news', 'error');
    }
};

// ======================================
// USERS MANAGEMENT
// ======================================

async function loadUsers() {
    const { data: users } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false });

    const tbody = document.getElementById('usersTable');
    
    if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No users found</td></tr>';
        return;
    }

    tbody.innerHTML = users.map(user => `
        <tr>
            <td>${user.username}</td>
            <td>${user.ip_address}</td>
            <td>${formatCurrency(user.balance)} MMK</td>
            <td>${formatCurrency(user.total_coins)} MMK</td>
            <td>${formatDate(user.created_at)}</td>
            <td><span class="status-badge ${user.is_banned ? 'banned' : 'approved'}">${user.is_banned ? 'Banned' : 'Active'}</span></td>
            <td>
                ${!user.is_banned ? `
                    <button class="btn-danger btn-icon" onclick="banUser('${user.id}', '${user.ip_address}')">
                        <i class="fas fa-ban"></i>
                    </button>
                ` : `
                    <button class="btn-success btn-icon" onclick="unbanUser('${user.id}', '${user.ip_address}')">
                        <i class="fas fa-check"></i>
                    </button>
                `}
            </td>
        </tr>
    `).join('');
}

window.banUser = async function(userId, ip) {
    if (!confirm('Are you sure you want to ban this user?')) return;

    try {
        // Ban user
        await supabase
            .from('users')
            .update({ is_banned: true })
            .eq('id', userId);

        // Add IP to banned list
        await supabase
            .from('banned_ips')
            .insert([{
                ip_address: ip,
                reason: 'User banned by admin'
            }]);

        showToast('User banned', 'success');
        loadUsers();
    } catch (error) {
        showToast('Failed to ban user', 'error');
    }
};

window.unbanUser = async function(userId, ip) {
    if (!confirm('Are you sure you want to unban this user?')) return;

    try {
        // Unban user
        await supabase
            .from('users')
            .update({ is_banned: false })
            .eq('id', userId);

        // Remove IP from banned list
        await supabase
            .from('banned_ips')
            .delete()
            .eq('ip_address', ip);

        showToast('User unbanned', 'success');
        loadUsers();
    } catch (error) {
        showToast('Failed to unban user', 'error');
    }
};

// ======================================
// PLAN PURCHASES MANAGEMENT
// ======================================

async function loadPurchases() {
    const { data: purchases } = await supabase
        .from('user_plan_purchases')
        .select('*, users(username), plans(name, duration_hours), payments(name)')
        .order('purchased_at', { ascending: false });

    const tbody = document.getElementById('purchasesTable');
    
    if (!purchases || purchases.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">No purchase requests</td></tr>';
        return;
    }

    tbody.innerHTML = purchases.map(purchase => `
        <tr>
            <td>${purchase.order_number}</td>
            <td>${purchase.users?.username || 'N/A'}</td>
            <td>${purchase.plans?.name || 'N/A'}</td>
            <td>${purchase.payments?.name || 'N/A'}</td>
            <td>...${purchase.transaction_last_6}</td>
            <td>${formatDate(purchase.purchased_at)}</td>
            <td><span class="status-badge ${purchase.status}">${purchase.status}</span></td>
            <td>
                ${purchase.status === 'pending' ? `
                    <button class="btn-success btn-icon" onclick="approvePurchase('${purchase.id}', '${purchase.user_id}', '${purchase.plan_id}', ${purchase.plans?.duration_hours})">
                        <i class="fas fa-check"></i>
                    </button>
                    <button class="btn-danger btn-icon" onclick="rejectPurchase('${purchase.id}')">
                        <i class="fas fa-times"></i>
                    </button>
                ` : '-'}
            </td>
        </tr>
    `).join('');
}

window.approvePurchase = async function(purchaseId, userId, planId, durationHours) {
    if (!confirm('Approve this purchase?')) return;

    try {
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

        // Update purchase status
        await supabase
            .from('user_plan_purchases')
            .update({ 
                status: 'approved',
                approved_at: new Date().toISOString()
            })
            .eq('id', purchaseId);

        // Create mining session
        const endTime = new Date();
        endTime.setHours(endTime.getHours() + durationHours);

        await supabase
            .from('user_mining_sessions')
            .insert([{
                user_id: userId,
                mining_type: 'plan',
                plan_id: planId,
                start_time: new Date().toISOString(),
                end_time: endTime.toISOString(),
                target_amount: plan.total_amount,
                current_amount: 0,
                is_completed: false
            }]);

        showToast('Purchase approved!', 'success');
        loadPurchases();
        loadDashboardStats();
    } catch (error) {
        console.error('Error approving purchase:', error);
        showToast('Failed to approve purchase', 'error');
    }
};

window.rejectPurchase = async function(purchaseId) {
    if (!confirm('Reject this purchase?')) return;

    try {
        await supabase
            .from('user_plan_purchases')
            .update({ status: 'rejected' })
            .eq('id', purchaseId);

        showToast('Purchase rejected', 'success');
        loadPurchases();
        loadDashboardStats();
    } catch (error) {
        showToast('Failed to reject purchase', 'error');
    }
};

// ======================================
// WITHDRAWALS MANAGEMENT
// ======================================

async function loadWithdrawals() {
    const { data: withdrawals } = await supabase
        .from('withdrawal_requests')
        .select('*, users(username, balance)')
        .order('requested_at', { ascending: false });

    const tbody = document.getElementById('withdrawalsTable');
    
    if (!withdrawals || withdrawals.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">No withdrawal requests</td></tr>';
        return;
    }

    tbody.innerHTML = withdrawals.map(withdrawal => `
        <tr>
            <td>${withdrawal.users?.username || 'N/A'}</td>
            <td>${formatCurrency(withdrawal.amount)} MMK</td>
            <td>${withdrawal.payment_type}</td>
            <td>${withdrawal.account_name}</td>
            <td>${withdrawal.payment_address}</td>
            <td>${formatDate(withdrawal.requested_at)}</td>
            <td><span class="status-badge ${withdrawal.status}">${withdrawal.status}</span></td>
            <td>
                ${withdrawal.status === 'pending' ? `
                    <button class="btn-success btn-icon" onclick="approveWithdrawal('${withdrawal.id}', '${withdrawal.user_id}')">
                        <i class="fas fa-check"></i>
                    </button>
                    <button class="btn-danger btn-icon" onclick="rejectWithdrawal('${withdrawal.id}', '${withdrawal.user_id}', ${withdrawal.amount})">
                        <i class="fas fa-times"></i>
                    </button>
                ` : '-'}
            </td>
        </tr>
    `).join('');
}

window.approveWithdrawal = async function(withdrawalId, userId) {
    if (!confirm('Approve this withdrawal? Make sure payment has been sent.')) return;

    try {
        await supabase
            .from('withdrawal_requests')
            .update({ 
                status: 'approved',
                processed_at: new Date().toISOString()
            })
            .eq('id', withdrawalId);

        showToast('Withdrawal approved!', 'success');
        loadWithdrawals();
        loadDashboardStats();
    } catch (error) {
        showToast('Failed to approve withdrawal', 'error');
    }
};

window.rejectWithdrawal = async function(withdrawalId, userId, amount) {
    if (!confirm('Reject this withdrawal? Amount will be returned to user balance.')) return;

    try {
        // Update withdrawal status
        await supabase
            .from('withdrawal_requests')
            .update({ 
                status: 'rejected',
                processed_at: new Date().toISOString()
            })
            .eq('id', withdrawalId);

        // Return amount to user balance
        const { data: user } = await supabase
            .from('users')
            .select('balance')
            .eq('id', userId)
            .single();

        if (user) {
            await supabase
                .from('users')
                .update({ balance: parseFloat(user.balance) + parseFloat(amount) })
                .eq('id', userId);
        }

        showToast('Withdrawal rejected and amount returned', 'success');
        loadWithdrawals();
        loadDashboardStats();
    } catch (error) {
        showToast('Failed to reject withdrawal', 'error');
    }
};

// ======================================
// MODAL HANDLERS
// ======================================

document.querySelectorAll('.modal .close').forEach(closeBtn => {
    closeBtn.addEventListener('click', () => {
        closeBtn.closest('.modal').classList.remove('active');
    });
});

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
        await checkAdminAuth();
        document.getElementById('loadingScreen').style.display = 'none';
    } catch (error) {
        console.error('Initialization error:', error);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Auto-refresh pending actions every 30 seconds
setInterval(() => {
    if (adminAuthorized) {
        loadPendingActions();
    }
}, 30000);
