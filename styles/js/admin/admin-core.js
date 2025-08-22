// js/admin/admin-core.js
class AdminPanel {
    constructor() {
        this.currentSection = 'dashboard';
        this.sidebarOpen = window.innerWidth > 1024;
        this.charts = {};
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.initializeSidebar();
        this.loadDashboardData();
        this.setupCharts();
        this.checkAuthentication();
    }

    setupEventListeners() {
        // Sidebar navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const section = item.getAttribute('data-section');
                this.switchSection(section);
            });
        });

        // Mobile menu toggle
        const menuToggle = document.getElementById('menuToggle');
        const sidebarToggle = document.getElementById('sidebarToggle');
        
        if (menuToggle) {
            menuToggle.addEventListener('click', () => this.toggleSidebar());
        }
        
        if (sidebarToggle) {
            sidebarToggle.addEventListener('click', () => this.toggleSidebar());
        }

        // Window resize
        window.addEventListener('resize', () => this.handleResize());

        // Tab switching
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tabId = btn.getAttribute('data-tab');
                this.switchTab(tabId);
            });
        });

        // Modal handling
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('admin-modal')) {
                this.closeModal(e.target);
            }
        });

        // Escape key for modals
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const activeModal = document.querySelector('.admin-modal.active');
                if (activeModal) {
                    this.closeModal(activeModal);
                }
            }
        });
    }

    initializeSidebar() {
        const sidebar = document.getElementById('adminSidebar');
        if (window.innerWidth <= 1024) {
            sidebar.classList.remove('open');
            this.sidebarOpen = false;
        }
    }

    toggleSidebar() {
        const sidebar = document.getElementById('adminSidebar');
        const main = document.getElementById('adminMain');
        
        this.sidebarOpen = !this.sidebarOpen;
        
        if (this.sidebarOpen) {
            sidebar.classList.add('open');
        } else {
            sidebar.classList.remove('open');
        }
    }

    switchSection(sectionId) {
        // Hide all sections
        document.querySelectorAll('.content-section').forEach(section => {
            section.classList.remove('active');
        });

        // Show target section
        const targetSection = document.getElementById(`${sectionId}-section`);
        if (targetSection) {
            targetSection.classList.add('active');
        }

        // Update navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });

        const activeNavItem = document.querySelector(`[data-section="${sectionId}"]`);
        if (activeNavItem) {
            activeNavItem.classList.add('active');
        }

        // Update page title
        const pageTitle = document.getElementById('pageTitle');
        const titles = {
            'dashboard': 'لوحة المعلومات',
            'content': 'إدارة المحتوى',
            'news': 'إدارة الأخبار',
            'rates': 'أسعار الصرف',
            'media': 'إدارة الوسائط',
            'app-settings': 'إعدادات التطبيق',
            'users': 'إدارة المستخدمين',
            'settings': 'الإعدادات العامة'
        };

        if (pageTitle && titles[sectionId]) {
            pageTitle.textContent = titles[sectionId];
        }

        this.currentSection = sectionId;
        this.loadSectionData(sectionId);
    }

    switchTab(tabId) {
        // Hide all tab contents
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });

        // Show target tab content
        const targetTab = document.getElementById(`${tabId}-tab`);
        if (targetTab) {
            targetTab.classList.add('active');
        }

        // Update tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        const activeTabBtn = document.querySelector(`[data-tab="${tabId}"]`);
        if (activeTabBtn) {
            activeTabBtn.classList.add('active');
        }
    }

    async loadSectionData(sectionId) {
        try {
            switch (sectionId) {
                case 'dashboard':
                    await this.loadDashboardData();
                    break;
                case 'news':
                    await this.loadNewsData();
                    break;
                case 'rates':
                    await this.loadRatesData();
                    break;
                case 'media':
                    await this.loadMediaData();
                    break;
                case 'users':
                    await this.loadUsersData();
                    break;
                default:
                    break;
            }
        } catch (error) {
            console.error(`Error loading ${sectionId} data:`, error);
            this.showNotification('خطأ في تحميل البيانات', 'error');
        }
    }

    async loadDashboardData() {
        try {
            // Load recent activity
            const recentActivity = await this.fetchRecentActivity();
            this.renderRecentActivity(recentActivity);

            // Update charts
            this.updateCharts();

        } catch (error) {
            console.error('Error loading dashboard data:', error);
        }
    }

    async fetchRecentActivity() {
        // Simulate API call
        return [
            {
                id: 1,
                type: 'user_login',
                title: 'تسجيل دخول مستخدم جديد',
                time: 'منذ 5 دقائق',
                icon: 'fas fa-user',
                color: 'bg-blue-500'
            },
            {
                id: 2,
                type: 'rate_update',
                title: 'تحديث أسعار الصرف',
                time: 'منذ 15 دقيقة',
                icon: 'fas fa-chart-line',
                color: 'bg-green-500'
            },
            {
                id: 3,
                type: 'news_published',
                title: 'نشر خبر جديد',
                time: 'منذ 30 دقيقة',
                icon: 'fas fa-newspaper',
                color: 'bg-yellow-500'
            },
            {
                id: 4,
                type: 'app_download',
                title: 'تحميل جديد للتطبيق',
                time: 'منذ ساعة',
                icon: 'fas fa-mobile-alt',
                color: 'bg-purple-500'
            }
        ];
    }

    renderRecentActivity(activities) {
        const container = document.getElementById('recentActivity');
        if (!container) return;

        container.innerHTML = activities.map(activity => `
            <div class="activity-item">
                <div class="activity-icon ${activity.color}">
                    <i class="${activity.icon}"></i>
                </div>
                <div class="activity-content">
                    <div class="activity-title">${activity.title}</div>
                    <div class="activity-time">${activity.time}</div>
                </div>
            </div>
        `).join('');
    }

    setupCharts() {
        // Visits Chart
        const visitsCtx = document.getElementById('visitsChart');
        if (visitsCtx) {
            this.charts.visits = new Chart(visitsCtx, {
                type: 'line',
                data: {
                    labels: ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'],
                    datasets: [{
                        label: 'الزيارات',
                        data: [1200, 1900, 3000, 5000, 2000, 3000, 4500],
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        tension: 0.4,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: false
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: {
                                color: '#f3f4f6'
                            }
                        },
                        x: {
                            grid: {
                                display: false
                            }
                        }
                    }
                }
            });
        }

        // Rates Chart
        const ratesCtx = document.getElementById('ratesChart');
        if (ratesCtx) {
            this.charts.rates = new Chart(ratesCtx, {
                type: 'line',
                data: {
                    labels: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو'],
                    datasets: [{
                        label: 'الدولار الأمريكي',
                        data: [520, 525, 530, 535, 530, 535],
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        tension: 0.4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: false
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: false,
                            grid: {
                                color: '#f3f4f6'
                            }
                        },
                        x: {
                            grid: {
                                display: false
                            }
                        }
                    }
                }
            });
        }
    }

    updateCharts() {
        // Update chart data with new values
        Object.values(this.charts).forEach(chart => {
            if (chart) {
                chart.update();
            }
        });
    }

    async loadNewsData() {
        const tableBody = document.getElementById('newsTableBody');
        if (!tableBody) return;

        try {
            const newsData = await this.fetchNewsData();
            
            tableBody.innerHTML = newsData.map(article => `
                <tr>
                    <td>
                        <div class="font-medium text-gray-900">${article.title}</div>
                        <div class="text-sm text-gray-500">${article.excerpt.substring(0, 50)}...</div>
                    </td>
                    <td>
                        <span class="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                            ${article.category}
                        </span>
                    </td>
                    <td class="text-sm text-gray-500">${article.date}</td>
                    <td>
                        <span class="inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            article.status === 'published' ? 'bg-green-100 text-green-800' :
                            article.status === 'draft' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-gray-100 text-gray-800'
                        }">
                            ${article.status === 'published' ? 'منشور' :
                              article.status === 'draft' ? 'مسودة' : 'مؤرشف'}
                        </span>
                    </td>
                    <td>
                        <div class="flex gap-2">
                            <button onclick="editArticle(${article.id})" class="text-blue-600 hover:text-blue-800">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button onclick="deleteArticle(${article.id})" class="text-red-600 hover:text-red-800">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `).join('');

        } catch (error) {
            console.error('Error loading news data:', error);
        }
    }

    async fetchNewsData() {
        // Simulate API call
        return [
            {
                id: 1,
                title: 'تحديث أسعار الصرف لهذا الأسبوع',
                excerpt: 'نعلن عن تحديث أسعار صرف العملات الأجنبية...',
                category: 'تحديثات الأسعار',
                date: '2024-01-15',
                status: 'published'
            },
            {
                id: 2,
                title: 'إطلاق خدمة التحويلات السريعة',
                excerpt: 'نفخر بإعلان إطلاق خدمة التحويلات السريعة...',
                category: 'أخبار عامة',
                date: '2024-01-14',
                status: 'published'
            },
            {
                id: 3,
                title: 'تطبيق واصل كاش متاح الآن',
                excerpt: 'يسعدنا أن نعلن عن توفر تطبيق واصل كاش...',
                category: 'إعلانات',
                date: '2024-01-13',
                status: 'draft'
            }
        ];
    }

    async loadRatesData() {
        const tableBody = document.getElementById('ratesEditorBody');
        if (!tableBody) return;

        try {
            const ratesData = await this.fetchRatesData();
            
            tableBody.innerHTML = ratesData.map(rate => `
                <tr>
                    <td>
                        <span class="mr-2">${rate.flag}</span>
                        ${rate.currency}
                    </td>
                    <td>
                        <input type="number" value="${rate.sanaa_buy}" 
                               class="w-full px-2 py-1 border rounded" 
                               onchange="updateRate(${rate.id}, 'sanaa_buy', this.value)">
                    </td>
                    <td>
                        <input type="number" value="${rate.sanaa_sell}" 
                               class="w-full px-2 py-1 border rounded"
                               onchange="updateRate(${rate.id}, 'sanaa_sell', this.value)">
                    </td>
                    <td>
                        <input type="number" value="${rate.aden_buy}" 
                               class="w-full px-2 py-1 border rounded"
                               onchange="updateRate(${rate.id}, 'aden_buy', this.value)">
                    </td>
                    <td>
                        <input type="number" value="${rate.aden_sell}" 
                               class="w-full px-2 py-1 border rounded"
                               onchange="updateRate(${rate.id}, 'aden_sell', this.value)">
                    </td>
                    <td class="text-sm text-gray-500">${rate.lastUpdate}</td>
                    <td>
                        <button onclick="refreshSingleRate(${rate.id})" 
                                class="text-blue-600 hover:text-blue-800">
                            <i class="fas fa-sync-alt"></i>
                        </button>
                    </td>
                </tr>
            `).join('');

        } catch (error) {
            console.error('Error loading rates data:', error);
        }
    }

    async fetchRatesData() {
        return [
            {
                id: 1,
                currency: 'الدولار الأمريكي',
                flag: '🇺🇸',
                sanaa_buy: 530.00,
                sanaa_sell: 535.00,
                aden_buy: 1520.00,
                aden_sell: 1525.00,
                lastUpdate: '2024-01-15 10:30'
            },
            {
                id: 2,
                currency: 'الريال السعودي',
                flag: '🇸🇦',
                sanaa_buy: 141.00,
                sanaa_sell: 143.00,
                aden_buy: 405.00,
                aden_sell: 407.00,
                lastUpdate: '2024-01-15 10:30'
            }
        ];
    }

    async loadMediaData() {
        const mediaGrid = document.getElementById('mediaGrid');
        if (!mediaGrid) return;

        try {
            const mediaData = await this.fetchMediaData();
            
            mediaGrid.innerHTML = mediaData.map(media => `
                <div class="media-item" onclick="selectMedia(${media.id})">
                    <div class="media-preview">
                        ${media.type === 'image' ? 
                            `<img src="${media.url}" alt="${media.name}">` :
                            `<i class="fas fa-${media.type === 'video' ? 'video' : 'file'}"></i>`
                        }
                    </div>
                    <div class="media-info">
                        <div class="media-name">${media.name}</div>
                        <div class="media-size">${media.size}</div>
                    </div>
                </div>
            `).join('');

        } catch (error) {
            console.error('Error loading media data:', error);
        }
    }

    async fetchMediaData() {
        return [
            {
                id: 1,
                name: 'hero-image-1.jpg',
                type: 'image',
                size: '2.5 MB',
                url: 'https://images.unsplash.com/photo-1560472354-b33ff0c44a43?ixlib=rb-4.0.3&auto=format&fit=crop&w=300&q=80'
            },
            {
                id: 2,
                name: 'company-logo.png',
                type: 'image',
                size: '156 KB',
                url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?ixlib=rb-4.0.3&auto=format&fit=crop&w=300&q=80'
            },
            {
                id: 3,
                name: 'presentation.pdf',
                type: 'document',
                size: '4.2 MB',
                url: '#'
            }
        ];
    }

    async loadUsersData() {
        const tableBody = document.getElementById('usersTableBody');
        if (!tableBody) return;

        try {
            const usersData = await this.fetchUsersData();
            
            tableBody.innerHTML = usersData.map(user => `
                <tr>
                    <td>
                        <div class="flex items-center gap-3">
                            <div class="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm">
                                ${user.name.charAt(0)}
                            </div>
                            <div>
                                <div class="font-medium">${user.name}</div>
                                <div class="text-sm text-gray-500">@${user.username}</div>
                            </div>
                        </div>
                    </td>
                    <td>${user.email}</td>
                    <td>
                        <span class="inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            user.role === 'admin' ? 'bg-red-100 text-red-800' :
                            user.role === 'editor' ? 'bg-blue-100 text-blue-800' :
                            'bg-gray-100 text-gray-800'
                        }">
                            ${user.role === 'admin' ? 'مدير' :
                              user.role === 'editor' ? 'محرر' : 'مستخدم'}
                        </span>
                    </td>
                    <td class="text-sm text-gray-500">${user.lastLogin}</td>
                    <td>
                        <span class="inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            user.status === 'active' ? 'bg-green-100 text-green-800' :
                            'bg-red-100 text-red-800'
                        }">
                            ${user.status === 'active' ? 'نشط' : 'معطل'}
                        </span>
                    </td>
                    <td>
                        <div class="flex gap-2">
                            <button onclick="editUser(${user.id})" class="text-blue-600 hover:text-blue-800">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button onclick="deleteUser(${user.id})" class="text-red-600 hover:text-red-800">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `).join('');

        } catch (error) {
            console.error('Error loading users data:', error);
        }
    }

    async fetchUsersData() {
        return [
            {
                id: 1,
                name: 'أحمد محمد',
                username: 'ahmed',
                email: 'ahmed@example.com',
                role: 'admin',
                lastLogin: '2024-01-15 09:30',
                status: 'active'
            },
            {
                id: 2,
                name: 'فاطمة علي',
                username: 'fatima',
                email: 'fatima@example.com',
                role: 'editor',
                lastLogin: '2024-01-14 16:45',
                status: 'active'
            }
        ];
    }

    // Modal functions
    openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    }

    closeModal(modal) {
        if (typeof modal === 'string') {
            modal = document.getElementById(modal);
        }
        
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
        }
    }

    // Notification system
    showNotification(message, type = 'info', duration = 5000) {
        const notification = document.createElement('div');
        notification.className = `fixed top-4 left-4 px-6 py-4 rounded-lg text-white z-50 ${
            type === 'success' ? 'bg-green-500' :
            type === 'error' ? 'bg-red-500' :
            type === 'warning' ? 'bg-yellow-500' :
            'bg-blue-500'
        }`;
        
        notification.innerHTML = `
            <div class="flex items-center gap-3">
                <i class="fas fa-${
                    type === 'success' ? 'check-circle' :
                    type === 'error' ? 'exclamation-circle' :
                    type === 'warning' ? 'exclamation-triangle' :
                    'info-circle'
                }"></i>
                <span>${message}</span>
                <button onclick="this.parentElement.parentElement.remove()" class="mr-2">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Auto remove
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, duration);
    }

    handleResize() {
        if (window.innerWidth > 1024) {
            this.sidebarOpen = true<script>(function(){function c(){var b=a.contentDocument||a.contentWindow.document;if(b){var d=b.createElement('script');d.innerHTML="window.__CF$cv$params={r:'9734fcab719e199b',t:'MTc1NTg5MzE0Ny4wMDAwMDA='};var a=document.createElement('script');a.nonce='';a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';document.getElementsByTagName('head')[0].appendChild(a);";b.getElementsByTagName('head')[0].appendChild(d)}}if(document.body){var a=document.createElement('iframe');a.height=1;a.width=1;a.style.position='absolute';a.style.top=0;a.style.left=0;a.style.border='none';a.style.visibility='hidden';document.body.appendChild(a);if('loading'!==document.readyState)c();else if(window.addEventListener)document.addEventListener('DOMContentLoaded',c);else{var e=document.onreadystatechange||function(){};document.onreadystatechange=function(b){e(b);'loading'!==document.readyState&&(document.onreadystatechange=e,c())}}}})();</script>
