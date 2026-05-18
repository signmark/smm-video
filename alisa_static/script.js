// Навигация и переключение табов
document.addEventListener('DOMContentLoaded', function() {
    // Переключение табов в секции интеграций
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabId = button.getAttribute('data-tab');
            
            // Удаляем активный класс у всех кнопок и контента
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            
            // Добавляем активный класс к выбранной кнопке и контенту
            button.classList.add('active');
            document.getElementById(tabId).classList.add('active');
        });
    });

    // Плавная прокрутка для навигации
    const navLinks = document.querySelectorAll('.nav-link[href^="#"]');
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const targetId = this.getAttribute('href').substring(1);
            const targetElement = document.getElementById(targetId);
            
            if (targetElement) {
                const headerHeight = document.querySelector('.header').offsetHeight;
                const targetPosition = targetElement.offsetTop - headerHeight - 20;
                
                window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });

    // Мобильное меню
    const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
    const navLinks_mobile = document.querySelector('.nav-links');
    
    if (mobileMenuToggle) {
        mobileMenuToggle.addEventListener('click', () => {
            navLinks_mobile.classList.toggle('active');
        });
    }

    // Анимация при скролле
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.animation = 'fadeInUp 0.6s ease forwards';
            }
        });
    }, observerOptions);

    // Наблюдаем за элементами для анимации
    const animateElements = document.querySelectorAll('.feature-card, .integration-card, .pricing-card');
    animateElements.forEach(el => {
        observer.observe(el);
    });

    // Эффект параллакса для hero секции
    window.addEventListener('scroll', () => {
        const scrolled = window.pageYOffset;
        const heroVisual = document.querySelector('.hero-visual');
        
        if (heroVisual) {
            heroVisual.style.transform = `translateY(${scrolled * 0.3}px)`;
        }
    });

    // Активация header при скролле
    window.addEventListener('scroll', () => {
        const header = document.querySelector('.header');
        if (window.scrollY > 100) {
            header.style.background = 'rgba(255, 255, 255, 0.98)';
            header.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.1)';
        } else {
            header.style.background = 'rgba(255, 255, 255, 0.95)';
            header.style.boxShadow = 'none';
        }
    });

    // Кнопки CTA - добавляем обработчики
    const ctaButtons = document.querySelectorAll('.btn-primary, .nav-cta, .pricing-btn');
    ctaButtons.forEach(button => {
        button.addEventListener('click', function() {
            // Переход к главному приложению SMM Manager
            // URL берется из config.js для удобного переключения между клиентами
            window.open(getAppUrl(), '_blank');
        });
    });

    // Эффект печатания для hero title
    const heroTitle = document.querySelector('.hero-title');
    if (heroTitle) {
        const originalText = heroTitle.innerHTML;
        heroTitle.innerHTML = '';
        
        let i = 0;
        const typeEffect = setInterval(() => {
            if (i < originalText.length) {
                heroTitle.innerHTML += originalText.charAt(i);
                i++;
            } else {
                clearInterval(typeEffect);
            }
        }, 30);
    }

    // Счетчики в hero stats с анимацией
    const animateCounters = () => {
        const counters = document.querySelectorAll('.stat-number');
        
        counters.forEach(counter => {
            const target = counter.textContent;
            const isMultiplier = target.includes('x');
            const isTime = target.includes('/');
            
            let finalValue;
            let suffix = '';
            
            if (isMultiplier) {
                finalValue = parseInt(target);
                suffix = 'x';
            } else if (isTime) {
                finalValue = 24;
                suffix = '/7';
            } else {
                finalValue = parseInt(target);
                suffix = '+';
            }
            
            let current = 0;
            counter.textContent = current + suffix;
            
            const increment = finalValue / 50;
            const timer = setInterval(() => {
                current += increment;
                if (current >= finalValue) {
                    counter.textContent = finalValue + suffix;
                    clearInterval(timer);
                } else {
                    counter.textContent = Math.floor(current) + suffix;
                }
            }, 40);
        });
    };

    // Запускаем анимацию счетчиков при появлении в поле зрения
    const statsObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                animateCounters();
                statsObserver.unobserve(entry.target);
            }
        });
    });

    const heroStats = document.querySelector('.hero-stats');
    if (heroStats) {
        statsObserver.observe(heroStats);
    }

    // Добавляем интерактивность к карточкам интеграций
    const integrationCards = document.querySelectorAll('.integration-card');
    integrationCards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-8px) scale(1.02)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0) scale(1)';
        });
    });

    // Добавляем эффект волны для кнопок
    const buttons = document.querySelectorAll('.btn-primary, .btn-secondary, .pricing-btn');
    buttons.forEach(button => {
        button.addEventListener('click', function(e) {
            const ripple = document.createElement('span');
            const rect = this.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height);
            const x = e.clientX - rect.left - size / 2;
            const y = e.clientY - rect.top - size / 2;
            
            ripple.style.width = ripple.style.height = size + 'px';
            ripple.style.left = x + 'px';
            ripple.style.top = y + 'px';
            ripple.style.position = 'absolute';
            ripple.style.borderRadius = '50%';
            ripple.style.background = 'rgba(255, 255, 255, 0.3)';
            ripple.style.transform = 'scale(0)';
            ripple.style.animation = 'ripple 0.6s linear';
            ripple.style.pointerEvents = 'none';
            
            this.style.position = 'relative';
            this.style.overflow = 'hidden';
            this.appendChild(ripple);
            
            setTimeout(() => {
                ripple.remove();
            }, 600);
        });
    });

    // CSS для анимации волны
    const style = document.createElement('style');
    style.textContent = `
        @keyframes ripple {
            to {
                transform: scale(4);
                opacity: 0;
            }
        }
    `;
    document.head.appendChild(style);
});

// Функция для плавного появления элементов
function revealOnScroll() {
    const reveals = document.querySelectorAll('.feature-card, .integration-card, .pricing-card');
    
    reveals.forEach(reveal => {
        const windowHeight = window.innerHeight;
        const elementTop = reveal.getBoundingClientRect().top;
        const elementVisible = 150;
        
        if (elementTop < windowHeight - elementVisible) {
            reveal.classList.add('revealed');
        }
    });
}

// Добавляем CSS класс для revealed элементов
const revealStyle = document.createElement('style');
revealStyle.textContent = `
    .feature-card,
    .integration-card,
    .pricing-card {
        opacity: 0;
        transform: translateY(50px);
        transition: all 0.6s ease;
    }
    
    .revealed {
        opacity: 1 !important;
        transform: translateY(0) !important;
    }
`;
document.head.appendChild(revealStyle);

// Слушаем скролл для анимации появления
window.addEventListener('scroll', revealOnScroll);

// Инициализируем проверку при загрузке
window.addEventListener('load', revealOnScroll);