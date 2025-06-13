# 🚀 Deployment Guide

This guide covers all deployment options for the Cybrdelic Portfolio website.

## 📋 Prerequisites

- Node.js 18+ installed
- Git repository with proper remote origin
- GitHub Pages enabled for the repository

## 🔧 Quick Deployment Commands

### Local Development
```bash
npm run dev                 # Start development server
npm run checkup:quick      # Quick health check before deploy
```

### Manual Deployment
```bash
npm run deploy             # Full automated deployment to GitHub Pages
npm run deploy:check       # Pre-deployment validation
npm run deploy:force       # Force deployment (use with caution)
```

### Production Build
```bash
npm run build:prod         # Build optimized production version
npm run serve:dist         # Preview production build locally
```

## 🤖 Automated Deployment (Recommended)

### GitHub Actions (Automatic)
The repository includes automated deployment via GitHub Actions:

1. **On every push to `main`**: Automatically builds and deploys
2. **On pull requests**: Creates preview builds for review
3. **Manual trigger**: Deploy on-demand via GitHub UI

#### Workflow Files:
- `.github/workflows/deploy.yml` - Main deployment pipeline
- `.github/workflows/preview.yml` - Preview builds for PRs

### Workflow Features:
- ✅ HTML validation
- 📊 Performance testing with Lighthouse
- 🔒 Security scanning
- 📦 Optimized builds with minification and compression
- 🚀 Automatic deployment to GitHub Pages

## 📦 Build Process

### What happens during `npm run build:prod`:
1. **Clean**: Removes old build artifacts
2. **Validate**: Checks HTML syntax and structure
3. **Minify**: Compresses HTML, CSS, and JavaScript
4. **Copy Assets**: Moves assets to distribution folder
5. **Compress**: Creates gzip versions for better performance

### Build Output:
```
dist/
├── index.html          # Minified main page
├── index.html.gz       # Gzipped version
└── assets/             # Copied assets (if any)
```

## 🔍 Pre-Deployment Checklist

Run these commands before deploying:

```bash
npm run checkup         # Comprehensive health check
npm run validate        # HTML validation
npm run size-check      # File size analysis
npm run audit          # Security audit
```

### Expected Results:
- ✅ HTML validation passes
- ✅ File sizes optimized (25KB → 14KB minified)
- ✅ Performance scores: 90%+ across all metrics
- ✅ No critical security vulnerabilities

## 🌐 GitHub Pages Setup

### Enable GitHub Pages:
1. Go to repository **Settings**
2. Navigate to **Pages** section
3. Select source: **GitHub Actions**
4. Save configuration

### Domain Configuration:
- Default URL: `https://cybrdelic.github.io`
- Custom domain: Configure in Pages settings if needed

## 🔄 Deployment Strategies

### 1. Automated (Recommended)
```bash
git add .
git commit -m "Update portfolio content"
git push origin main
# Deployment happens automatically via GitHub Actions
```

### 2. Manual Local Build
```bash
npm run build:prod     # Build locally
git add dist/          # Add build files
git commit -m "Deploy: $(date)"
git push origin main
```

### 3. Force Deployment
```bash
npm run deploy:force   # Builds, commits, and pushes everything
```

## 📊 Monitoring & Validation

### Post-Deployment Checks:
```bash
npm run status         # Check deployment status
npm run lighthouse:summary  # Performance metrics
npm run report         # Comprehensive report
```

### Performance Monitoring:
- Lighthouse scores tracked in CI/CD
- File size optimization reports
- Security vulnerability scanning

## 🚨 Troubleshooting

### Common Issues:

1. **Build Fails**:
   ```bash
   npm run diagnose      # Full diagnostic
   npm run clean         # Clean build directory
   npm install           # Reinstall dependencies
   ```

2. **Deployment Errors**:
   ```bash
   npm run deploy:check  # Pre-deployment validation
   git status            # Check repository state
   npm run reset         # Nuclear option: clean rebuild
   ```

3. **Performance Issues**:
   ```bash
   npm run perf-test     # Run lighthouse audit
   npm run minify        # Ensure minification worked
   npm run compress      # Check compression
   ```

### Debug Commands:
```bash
npm run diagnose:quick     # Quick file and dependency check
npm run diagnose:full      # Comprehensive diagnostics
npm run status:health      # Health status check
```

## 📁 File Management

### Ignored Files (`.gitignore`):
- `node_modules/` - Dependencies
- `dist/` - Build output (auto-generated)
- `lighthouse-report.json` - Performance reports
- `*.log` - Log files
- Environment and cache files

### Tracked Files:
- `index.html` - Source file
- `package.json` - Dependencies and scripts
- `assets/` - Static assets
- `.github/` - Workflow configurations

## 🔐 Security Considerations

### Automated Security:
- Dependency vulnerability scanning
- Security headers via `_headers` file
- Content Security Policy enforcement

### Manual Security Checks:
```bash
npm run security-scan   # Basic security check
npm audit              # Dependency audit
npm run fix-security   # Auto-fix vulnerabilities
```

## 📈 Performance Optimization

### Current Metrics:
- **Performance**: 92%
- **Accessibility**: 100%
- **Best Practices**: 96%
- **SEO**: 98%
- **File Size**: 25KB → 14KB (43% reduction)

### Optimization Features:
- HTML/CSS/JS minification
- Gzip compression
- Efficient tooltip loading
- Mobile-responsive design
- Optimized images (when added)

## 🎯 Best Practices

1. **Always run `npm run checkup` before deploying**
2. **Use automated deployment via GitHub Actions**
3. **Monitor performance metrics regularly**
4. **Keep dependencies updated with `npm run upgrade-deps`**
5. **Test locally with `npm run serve:dist` before deployment**

## 📞 Support

For deployment issues:
1. Check GitHub Actions logs
2. Run diagnostic scripts
3. Review this deployment guide
4. Check repository issues/discussions
