// js/main.js
class AbuHudhayfaWebsite {
    constructor() {
        this.currentSlide = 0;
        this.slides = [];
        this.isAutoSliding = true;
        this.slideInterval = null;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.initializeSlider();
        this.loadInitialData();
        this.startAnimations();
        this.setupScrollEffects();
    }

    setupEventListeners() {
        // Navigation
        document.addEventListener('DOMContentLoaded', () => {
            this.setupNavigation();
            this.setupMobileMenu();
            this.setupSmoothScrolling();
        });

        // Window events
        window.addEventListener('scroll', () => this.handleScroll());
        window.addEventListener('resize', () => this.handleResize());

        // Form submissions
        const contactForm = document.querySelector('.contact-form');
        if (contactForm) {
            contactForm.addEventListener('submit', (e) => this.submitContactForm(e));
        }
    }

    setupNavigation() {
        const navLinks = document.querySelectorAll('.nav-link');
        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = link.getAttribute('href').substring(1);
                this.scrollToSection(targetId);
                this.setActiveNavLink(link);
            });
        });
    }

    setupMobileMenu() {
        const mobileMenuBtn = document.querySelector('[onclick="toggleMobileMenu()"]');
        const mobileMenu = document.getElementById('mobileMenu');
        
        if (mobileMenuBtn && mobileMenu) {
            mobileMenuBtn.addEventListener('click', () => {
                mobileMenu.classList.toggle('hidden');
            });
        }
    }

    setupSmoothScrolling() {
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = anchor.getAttribute('href').substring(1);
                this.scrollToSection(targetId);
            });
        });
    }

    scrollToSection(sectionId) {
        const section = document.getElementById(sectionId);
        if (section) {
            const headerHeight = document.querySelector('nav').offsetHeight;
            const targetPosition = section.offsetTop - headerHeight;
            
            window.scrollTo({
                top: targetPosition,
                behavior: 'smooth'
            });
        }
    }

    setActiveNavLink(activeLink) {
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
        });
        activeLink.classList.add('active');
    }

    // Slider functionality
    initializeSlider() {
        this.slides = document.querySelectorAll('.slide');
        if (this.slides.length > 0) {
            this.startAutoSlide();
            this.setupSliderControls();
        }
    }

    startAutoSlide() {
        this.slideInterval = setInterval(() => {
            if (this.isAutoSliding) {
                this.nextSlide();
            }
        }, 5000);
    }

    nextSlide() {
        this.currentSlide = (this.currentSlide + 1) % this.slides.length;
        this.updateSlider();
    }

    goToSlide(index) {
        this.currentSlide = index;
        this.updateSlider();
        this.pauseAutoSlide();
    }

    updateSlider() {
        this.slides.forEach((slide, index) => {
            slide.classList.toggle('active', index === this.currentSlide);
        });

        const dots = document.querySelectorAll('.slider-dot');
        dots.forEach((dot, index) => {
            dot.classList.toggle('active', index === this.currentSlide);
        });
    }

    setupSliderControls() {
        const dots = document.querySelectorAll('.slider-dot');
        dots.forEach((dot, index) => {
            dot.addEventListener('click', () => this.goToSlide(index));
        });

        // Pause on hover
        const slider = document.querySelector('.hero-slider');
        if (slider) {
            slider.addEventListener('mouseenter', () => this.pauseAutoSlide());
            slider.addEventListener('mouseleave', () => this.resumeAutoSlide());
        }
    }

    pauseAutoSlide() {
        this.isAutoSliding = false;
        setTimeout(() => {
            this.isAutoSliding = true;
        }, 10000); // Resume after 10 seconds
    }

    resumeAutoSlide() {
        this.isAutoSliding = true;
    }

    // Data loading
    async loadInitialData() {
        try {
            await Promise.all([
                this.loadNews(),
                this.loadExchangeRates(),
                this.updateStatistics()
            ]);
        } catch (error) {
            console.error('Error loading initial data:', error);
        }
    }

    async loadNews() {
        try {
            const newsContainer = document.getElementById('newsContainer');
            if (!newsContainer) return;

            // Show loading state
            newsContainer.innerHTML = this.createLoadingCards(3);

            // Simulate API call or load from data source
            const newsData = await this.fetchNewsData();
            
            newsContainer.innerHTML = '';
            newsData.forEach(article => {
                const newsCard = this.createNewsCard(article);
                newsContainer.appendChild(newsCard);
            });

        } catch (error) {
            console.error('Error loading news:', error);
            this.showMessage('خطأ في تحميل الأخبار', 'error');
        }
    }

    async fetchNewsData() {
        // This would typically fetch from an API or database
        // For now, return sample data
        return [
            {
                id: 1,
                title: 'تحديث أسعار الصرف لهذا الأسبوع',
                excerpt: 'نعلن عن تحديث أسعار صرف العملات الأجنبية مقابل الريال اليمني لهذا الأسبوع...',
                category: 'تحديثات الأسعار',
                image: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=80',
                date: new Date().toLocaleDateString('ar-YE'),
                readTime: '3 دقائق'
            },
            {
                id: 2,
                title: 'إطلاق خدمة التحويلات السريعة',
                excerpt: 'نفخر بإعلان إطلاق خدمة التحويلات السريعة الجديدة التي تتيح لعملائنا...',
                category: 'أخبار عامة',
                image: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=80',
                date: new Date(Date.now() - 86400000).toLocaleDateString('ar-YE'),
                readTime: '5 دقائق'
            },
            {
                id: 3,
                title: 'تطبيق واصل كاش متاح الآن',
                excerpt: 'يسعدنا أن نعلن عن توفر تطبيق واصل كاش على متاجر التطبيقات...',
                category: 'إعلانات',
                image: 'https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=80',
                date: new Date(Date.now() - 172800000).toLocaleDateString('ar-YE'),
                readTime: '4 دقائق'
            }
        ];
    }

    createNewsCard(article) {
        const card = document.createElement('div');
        card.className = 'news-card hover-lift';
        card.innerHTML = `
            <img src="${article.image}" alt="${article.title}" class="news-image" loading="lazy">
            <div class="news-content">
                <span class="news-category">${article.category}</span>
                <h3 class="news-title">${article.title}</h3>
                <p class="news-excerpt">${article.excerpt}</p>
                <div class="news-meta">
                    <span>${article.date}</span>
                    <a href="#" class="read-more" onclick="readArticle(${article.id})">
                        اقرأ المزيد
                        <i class="fas fa-arrow-left mr-1"></i>
                    </a>
                </div>
            </div>
        `;
        return card;
    }

    createLoadingCards(count) {
        let html = '';
        for (let i = 0; i < count; i++) {
            html += `
                <div class="news-card loading">
                    <div class="w-full h-48 bg-gray-200 animate-pulse"></div>
                    <div class="news-content">
                        <div class="w-20 h-6 bg-gray-200 animate-pulse rounded mb-4"></div>
                        <div class="w-full h-6 bg-gray-200 animate-pulse rounded mb-2"></div>
                        <div class="w-3/4 h-6 bg-gray-200 animate-pulse rounded mb-4"></div>
                        <div class="w-full h-16 bg-gray-200 animate-pulse rounded"></div>
                    </div>
                </div>
            `;
        }
        return html;
    }

    async loadExchangeRates() {
        try {
            const ratesTableBody = document.getElementById('ratesTableBody');
            if (!ratesTableBody) return;

            // Show loading state
            ratesTableBody.innerHTML = this.createRatesLoadingRows();

            // Fetch rates data
            const ratesData = await this.fetchExchangeRates();
            
            ratesTableBody.innerHTML = '';
            ratesData.forEach(rate => {
                const row = this.createRateRow(rate);
                ratesTableBody.appendChild(row);
            });

            // Update last update time
            this.updateLastUpdateTime();

        } catch (error) {
            console.error('Error loading exchange rates:', error);
            this.showMessage('خطأ في تحميل أسعار الصرف', 'error');
        }
    }

    async fetchExchangeRates() {
        // This would typically fetch from an API
        return [
            {
                currency: 'الدولار الأمريكي',
                flag: '🇺🇸',
                sanaa_buy: '530.00',
                sanaa_sell: '535.00',
                aden_buy: '1,520.00',
                aden_sell: '1,525.00',
                change: '+0.5%',
                changeType: 'positive'
            },
            {
                currency: 'الريال السعودي',
                flag: '🇸🇦',
                sanaa_buy: '141.00',
                sanaa_sell: '143.00',
                aden_buy: '405.00',
                aden_sell: '407.00',
                change: '+0.2%',
                changeType: 'positive'
            },
            {
                currency: 'اليورو',
                flag: '🇪🇺',
                sanaa_buy: '580.00',
                sanaa_sell: '585.00',
                aden_buy: '1,650.00',
                aden_sell: '1,655.00',
                change: '-0.3%',
                changeType: 'negative'
            },
            {
                currency: 'الجنيه الإسترليني',
                flag: '🇬🇧',
                sanaa_buy: '670.00',
                sanaa_sell: '675.00',
                aden_buy: '1,900.00',
                aden_sell: '1,905.00',
                change: '+0.1%',
                changeType: 'positive'
            }
        ];
    }

    createRateRow(rate) {
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-50 transition-colors';
        row.innerHTML = `
            <td class="font-medium">
                <span class="mr-2">${rate.flag}</span>
                ${rate.currency}
            </td>
            <td class="font-mono">${rate.sanaa_buy}</td>
            <td class="font-mono">${rate.sanaa_sell}</td>
            <td class="font-mono">${rate.aden_buy}</td>
            <td class="font-mono">${rate.aden_sell}</td>
            <td>
                <span class="rate-change ${rate.changeType}">
                    <i class="fas fa-arrow-${rate.changeType === 'positive' ? 'up' : 'down'}"></i>
                    ${rate.change}
                </span>
            </td>
        `;
        return row;
    }

    createRatesLoadingRows() {
        let html = '';
        for (let i = 0; i < 4; i++) {
            html += `
                <tr class="animate-pulse">
                    <td><div class="h-4 bg-gray-200 rounded w-32"></div></td>
                    <td><div class="h-4 bg-gray-200 rounded w-16"></div></td>
                    <td><div class="h-4 bg-gray-200 rounded w-16"></div></td>
                    <td><div class="h-4 bg-gray-200 rounded w-16"></div></td>
                    <td><div class="h-4 bg-gray-200 rounded w-16"></div></td>
                    <td><div class="h-4 bg-gray-200 rounded w-12"></div></td>
                </tr>
            `;
        }
        return html;
    }

    updateLastUpdateTime() {
        const lastUpdateElement = document.getElementById('lastUpdateTime');
        if (lastUpdateElement) {
            const now = new Date();
            lastUpdateElement.textContent = now.toLocaleTimeString('ar-YE', {
                hour: '2-digit',
                minute: '2-digit'
            });
        }
    }

    async refreshRates() {
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i> جاري التحديث...';
            refreshBtn.disabled = true;
        }

        try {
            await this.loadExchangeRates();
            this.showMessage('تم تحديث الأسعار بنجاح', 'success');
        } catch (error) {
            this.showMessage('خطأ في تحديث الأسعار', 'error');
        } finally {
            if (refreshBtn) {
                refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> تحديث';
                refreshBtn.disabled = false;
            }
        }
    }

    // Statistics animation
    async updateStatistics() {
        const statNumbers = document.querySelectorAll('.stat-number');
        
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.animateNumber(entry.target);
                    observer.unobserve(entry.target);
                }
            });
        });

        statNumbers.forEach(stat => observer.observe(stat));
    }

    animateNumber(element) {
        const target = parseInt(element.getAttribute('data-target'));
        const duration = 2000;
        const step = target / (duration / 16);
        let current = 0;

        const timer = setInterval(() => {
            current += step;
            if (current >= target) {
                current = target;
                clearInterval(timer);
            }
            element.textContent = Math.floor(current).toLocaleString('ar-YE');
        }, 16);
    }

    // Form handling
    async submitContactForm(event) {
        event.preventDefault();
        
        const form = event.target;
        const formData = new FormData(form);
        const submitBtn = form.querySelector('.submit-btn');
        
        // Show loading state
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<div class="spinner"></div> جاري الإرسال...';
        submitBtn.disabled = true;

        try {
            // Simulate form submission
            await this.sendContactMessage(formData);
            
            this.showMessage('تم إرسال رسالتك بنجاح. سنتواصل معك قريباً', 'success');
            form.reset();
            
        } catch (error) {
            console.error('Error submitting form:', error);
            this.showMessage('حدث خطأ في إرسال الرسالة. يرجى المحاولة مرة أخرى', 'error');
        } finally {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    }

    async sendContactMessage(formData) {
        // This would typically send to a backend API
        // For now, simulate the request
        return new Promise((resolve) => {
            setTimeout(() => {
                console.log('Contact form data:', Object.fromEntries(formData));
                resolve();
            }, 2000);
        });
    }

    // Scroll effects
    handleScroll() {
        this.updateNavbarOnScroll();
        this.updateActiveNavLink();
    }

    updateNavbarOnScroll() {
        const navbar = document.querySelector('nav');
        if (navbar) {
            if (window.scrollY > 100) {
                navbar.classList.add('scrolled');
            } else {
                navbar.classList.remove('scrolled');
            }
        }
    }

    updateActiveNavLink() {
        const sections = document.querySelectorAll('section[id]');
        const navLinks = document.querySelectorAll('.nav-link');
        
        let currentSection = '';
        
        sections.forEach(section => {
            const sectionTop = section.offsetTop - 100;
            const sectionHeight = section.offsetHeight;
            
            if (window.scrollY >= sectionTop && window.scrollY < sectionTop + sectionHeight) {
                currentSection = section.getAttribute('id');
            }
        });

        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${currentSection}`) {
                link.classList.add('active');
            }
        });
    }

    setupScrollEffects() {
        // Parallax effect for hero section
        window.addEventListener('scroll', () => {
            const scrolled = window.pageYOffset;
            const parallax = document.querySelector('.hero-slider');
            if (parallax) {
                const speed = scrolled * 0.5;
                parallax.style.transform = `translateY(${speed}px)`;
            }
        });

        // Fade in animation for elements
        const observerOptions = {
            threshold: 0.1,
            rootMargin: '0px 0px -50px 0px'
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('animate-fade-in');
                }
            });
        }, observerOptions);

        document.querySelectorAll('.news-card, .stat-card, .contact-item').forEach(el => {
            observer.observe(el);
        });
    }

    startAnimations() {
        // Add CSS for fade in animation
        const style = document.createElement('style');
        style.textContent = `
            .animate-fade-in {
                animation: fadeInUp 0.6s ease-out forwards;
            }
            
            @keyframes fadeInUp {
                from {
                    opacity: 0;
                    transform: translateY(30px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
        `;
        document.head.appendChild(style);
    }

    handleResize() {
        // Handle responsive changes
        if (window.innerWidth < 768) {
            this.pauseAutoSlide();
        } else {
            this.resumeAutoSlide();
        }
    }

    // Admin login functionality
    showAdminLogin() {
        const modal = document.getElementById('adminLoginModal');
        if (modal) {
            modal.classList.add('active');
        }
    }

    hideAdminLogin() {
        const modal = document.getElementById('adminLoginModal');
        if (modal) {
            modal.classList.remove('active');
        }
    }

    async handleAdminLogin(event) {
        event.preventDefault();
        
        const form = event.target;
        const formData = new FormData(form);
        const username = formData.get('username');
        const password = formData.get('password');

        try {
            // Simulate authentication
            const isValid = await this.authenticateAdmin(username, password);
            
            if (isValid) {
                this.showMessage('تم تسجيل الدخول بنجاح', 'success');
                this.hideAdminLogin();
                
                // Redirect to admin panel
                setTimeout(() => {
                    window.location.href = 'admin.html';
                }, 1000);
            } else {
                this.showMessage('اسم المستخدم أو كلمة المرور غير صحيحة', 'error');
            }
        } catch (error) {
            console.error('Login error:', error);
            this.showMessage('حدث خطأ في تسجيل الدخول', 'error');
        }
    }

    async authenticateAdmin(username, password) {
        // This would typically authenticate with a backend
        // For demo purposes, use simple validation
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve(username === 'admin' && password === 'admin123');
            }, 1000);
        });
    }

    // Utility functions
    showMessage(message, type = 'info') {
        const messageContainer = document.getElementById('messageContainer') || document.body;
        
        const messageEl = document.createElement('div');
        messageEl.className = `message ${type}`;
        messageEl.innerHTML = `
            <span>${message}</span>
            <button onclick="this.parentElement.remove()" style="margin-right: 1rem; background: none; border: none; color: white; cursor: pointer;">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        messageContainer.appendChild(messageEl);
        
        // Auto remove after 5 seconds
        setTimeout(() => {
            if (messageEl.parentElement) {
                messageEl.remove();
            }
        }, 5000);
    }

    previewSite() {
        window.open('index.html', '_blank');
    }
}

// Global functions for onclick handlers
function toggleMobileMenu() {
    const mobileMenu = document.getElementById('mobileMenu');
    if (mobileMenu) {
        mobileMenu.classList.toggle('hidden');
    }
}

function goToSlide(index) {
    if (window.website) {
        window.website.goToSlide(index);
    }
}

function refreshRates() {
    if (window.website) {
        window.website.refreshRates();
    }
}

function scrollToSection(sectionId) {
    if (window.website) {
        window.website.scrollToSection(sectionId);
    }
}

function submitContactForm(event) {
    if (window.website) {
        window.website.submitContactForm(event);
    }
}

function showAdminLogin() {
    if (window.website) {
        window.website.showAdminLogin();
    }
}

function closeAdminLogin() {
    if (window.website) {
        window.website.hideAdminLogin();
    }
}

function handleAdminLogin(event) {
    if (window.website) {
        window.website.handleAdminLogin(event);
    }
}

function readArticle(articleId) {
    // This would typically navigate to a full article page
    console.log('Reading article:', articleId);
    window.website.showMessage('ميزة قراءة المقال الكامل قيد التطوير', 'info');
}

function previewSite() {
    if (window.website) {
        window.website.previewSite();
    }
}

// Initialize the website when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.website = new AbuHudhayfaWebsite();
});

// Handle modal clicks outside content
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.classList.remove('active');
    }
});

// Handle escape key for modals
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const activeModal = document.querySelector('.modal.active');
        if (activeModal) {
            activeModal.classList.remove('active');
        }
    }
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AbuHudhayfaWebsite;
}
