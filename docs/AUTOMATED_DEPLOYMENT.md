# 🤖 Automated Deployment Documentation

This document explains the automated deployment system for the Cybrdelic Portfolio website, which automatically deploys your changes to GitHub Pages on every push to the `master` branch.

> Update: Site content now sourced from TypeScript (`content/content.ts`) and injected into a tokenized `index.html` template during the build. Legacy YAML removed.

## 📋 Overview

The automated deployment system uses **GitHub Actions** to:
- ✅ Validate HTML and run quality checks (on generated `dist/index.html`)
- 🏗️ Build optimized production assets (token replacement + minification)
- 🚀 Deploy to GitHub Pages automatically
- 📊 Generate deployment reports

## 🔧 How It Works

### Trigger Events
The deployment workflow triggers on:
- **Push to master**: Automatic deployment
- **Pull Request**: Preview build (validation only)
- **Manual dispatch**: On-demand deployment via GitHub UI

### Workflow Steps
1. **Test & Validate** (`test` job)
   - HTML validation using `html-validate`
   - File size checks
   - Security scanning
   - Test build process
   - Status report generation

2. **Deploy** (`deploy` job - only on master push)
   - Production build with minification
   - Asset optimization and compression
   - Upload to GitHub Pages
   - Post-deployment verification

## 🚀 Simple Usage

### For Regular Updates
```bash
git add .
git commit -m "Update portfolio content"
git push origin master
```

### Using the Deploy Script
```bash
# Builds, commits, and pushes in one command
npm run deploy
```

## 🧩 Content Generation Flow
1. Edit `content/content.ts` (type-safe content object)
2. Edit `index.html` template structure (tokens only, no literal copy)
3. Run `npm run build` → generates `dist/index.html`
4. GitHub Actions validates and deploys the generated file

Tokens examples: `__META_TITLE__`, `<!-- SITE_NAME -->`, `<!-- PROJECTS_INJECT -->`.

## 📁 File Structure

```
content/            # TypeScript content source
index.html          # Template (placeholder tokens)
dist/index.html     # Generated output (what gets deployed)
scripts/build.js    # Token replacement + injection
```

## ⚙️ Workflow Configuration

### Environment Variables
- `NODE_VERSION: '18'` - Node.js version for builds

### Permissions Required
```yaml
permissions:
  contents: read     # Read repository content
  pages: write       # Write to GitHub Pages
  id-token: write    # Deploy to Pages
```

### Job Dependencies
```yaml
deploy:
  needs: test        # Deploy only runs if tests pass
  if: github.ref == 'refs/heads/master' && github.event_name == 'push'
```

## 🔍 Monitoring Deployments

### GitHub Actions Dashboard
- View deployment status: `https://github.com/cybrdelic/cybrdelic.github.io/actions`
- Monitor build logs and deployment progress
- Check for any failures or warnings

### Deployment Artifacts
The workflow generates:
- **Production build** in `dist/` directory
- **Compressed assets** (HTML, CSS, JS gzipped)
- **Deployment reports** with file sizes and optimization stats

## 📊 Quality Checks

### Automated Validations
- **HTML Validation**: Ensures valid HTML5 markup
- **File Size Monitoring**: Tracks asset sizes and compression ratios
- **Security Scanning**: Checks for vulnerabilities
- **Build Verification**: Confirms production build succeeds

### Performance Metrics
```bash
# Example output from deployment
Gzipped: 26 KB -> 7 KB  # 73% compression ratio
```

## 🛠️ Manual Deployment Scripts

### Available Commands
```bash
# Development
npm run dev                 # Start local development server

# Building
npm run build              # Standard build (TS content -> dist/index.html)
npm run build:prod         # Production build with optimization

# Deployment
npm run deploy             # Build and deploy to master
npm run deploy:check       # Pre-deployment validation
npm run deploy:force       # Force deployment (use with caution)

# Validation
npm run validate           # HTML validation (generated file)
npm run security-scan      # Security checks
npm run size-check         # File size analysis
```

## 🚨 Troubleshooting

### Common Issues

#### HTML Validation Errors
```bash
# Check for validation issues
npm run validate

# Common fixes needed:
# - Unclosed HTML tags
# - Invalid nesting
# - Missing required attributes
```

#### Deployment Failures
1. **Check GitHub Actions logs** for specific error messages
2. **Verify repository permissions** (Settings → Actions → General)
3. **Ensure GitHub Pages is enabled** (Settings → Pages → Source: GitHub Actions)

#### Build Issues
```bash
# Clean and rebuild
npm run reset

# Check build locally
npm run build:prod
```

### GitHub Pages Configuration
Ensure your repository is configured correctly:

1. **Repository Settings** → **Pages**
2. **Source**: Select "GitHub Actions" (not "Deploy from a branch")
3. **Custom domain** (optional): Configure if using custom domain

## 📈 Deployment History

### Tracking Changes
- All deployments are tracked in Git history
- GitHub Actions provides deployment logs and timing
- Each deployment includes build artifacts and size reports

### Rollback Process
```bash
# Revert to previous commit
git revert HEAD
git push origin master

# Or reset to specific commit
git reset --hard <commit-hash>
git push --force origin master  # Use with caution
```

## 🔐 Security & Permissions

### Repository Permissions
- **Actions**: Read and write permissions
- **Pages**: Write permissions
- **Contents**: Read permissions

### Secrets & Environment Variables
- No secrets required for basic deployment
- Environment variables defined in workflow files
- All builds run in isolated GitHub-hosted runners

## 📝 Best Practices

### Commit Messages
Use clear, descriptive commit messages:
```bash
git commit -m "Add new project: LeatherSim WebGL demo"
git commit -m "Update portfolio objective and skills"
git commit -m "Fix responsive design for mobile devices"
```

### Testing Before Push
```bash
# Local validation
npm run validate

# Local build test
npm run build:prod

# Local development preview
npm run dev
```

### Branch Management
- **Master branch**: Production-ready code only
- **Feature branches**: Use for development
- **Pull Requests**: For code review before merging

## 🌐 Live Site Information

- **Production URL**: https://cybrdelic.github.io
- **Deployment time**: ~1-2 minutes after push
- **CDN**: Served via GitHub Pages global CDN
- **SSL**: Automatic HTTPS with GitHub's certificate

## 📞 Support

### Resources
- **GitHub Actions Documentation**: https://docs.github.com/en/actions
- **GitHub Pages Documentation**: https://docs.github.com/en/pages
- **HTML Validation**: https://html-validate.org/

### Logs and Debugging
```bash
# Check deployment status
npm run status

# View recent Git history
git log --oneline -10

# Check remote configuration
git remote -v
```

---

*This automated deployment system ensures your portfolio is always up-to-date with minimal manual intervention. Every push to master triggers a complete build and deployment cycle, maintaining high quality and performance standards.*
