// Error tracking and performance monitoring
class ErrorTracker {
    constructor() {
        this.setupErrorHandling();
        this.setupPerformanceMonitoring();
    }

    setupErrorHandling() {
        window.addEventListener('error', (event) => {
            this.logError({
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                error: event.error?.stack
            });
        });

        window.addEventListener('unhandledrejection', (event) => {
            this.logError({
                message: 'Unhandled Promise Rejection',
                error: event.reason
            });
        });
    }

    setupPerformanceMonitoring() {
        // Track Core Web Vitals
        if ('web-vital' in window) {
            import('web-vitals').then(({ getCLS, getFID, getFCP, getLCP, getTTFB }) => {
                getCLS(this.logMetric.bind(this));
                getFID(this.logMetric.bind(this));
                getFCP(this.logMetric.bind(this));
                getLCP(this.logMetric.bind(this));
                getTTFB(this.logMetric.bind(this));
            });
        }

        // Track custom metrics
        this.trackLoadTime();
        this.trackInteractionMetrics();
    }

    logError(error) {
        console.error('Tracked Error:', error);

        // Send to analytics
        if (typeof gtag !== 'undefined') {
            gtag('event', 'exception', {
                description: error.message,
                fatal: false
            });
        }
    }

    logMetric(metric) {
        console.log('Performance Metric:', metric);

        // Send to analytics
        if (typeof gtag !== 'undefined') {
            gtag('event', metric.name, {
                value: Math.round(metric.value),
                metric_value: metric.value
            });
        }
    }

    trackLoadTime() {
        window.addEventListener('load', () => {
            const loadTime = performance.now();
            this.logMetric({
                name: 'page_load_time',
                value: loadTime
            });
        });
    }

    trackInteractionMetrics() {
        // Track form interactions
        document.addEventListener('submit', (event) => {
            if (event.target.id === 'mailingListForm') {
                this.logMetric({
                    name: 'form_submission',
                    value: 1
                });
            }
        });

        // Track link clicks
        document.addEventListener('click', (event) => {
            if (event.target.tagName === 'A') {
                this.logMetric({
                    name: 'link_click',
                    value: 1,
                    link_url: event.target.href
                });
            }
        });
    }
}

// Initialize error tracking
new ErrorTracker();
