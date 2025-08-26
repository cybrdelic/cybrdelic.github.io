# Cybrdelic Portfolio

> **🤖 Automated Deployment Enabled**: This repository automatically deploys to GitHub Pages on every push to `master`.

Portfolio website for Alejandro Figueroa, showcasing autonomous systems, WebGPU simulations, and cutting-edge computer graphics projects.

## 🚀 Live Site
**https://cybrdelic.github.io**

## 📁 Project Structure
```
├── index.html              # Main portfolio page
├── assets/                 # Static assets (CSS, JS, images)
├── .github/workflows/      # GitHub Actions deployment workflows
├── docs/                   # Documentation
├── tests/                  # Test specifications
└── package.json           # Build scripts and dependencies
```

## 🤖 Automated Deployment

This repository uses **GitHub Actions** for automatic deployment:

- ✅ **Triggers**: Every push to `master` branch
- 🔍 **Validation**: HTML validation, security scans, file size checks
- 🏗️ **Build**: Minification, compression, optimization
- 🚀 **Deploy**: Automatic deployment to GitHub Pages
- ⏱️ **Time**: ~1-2 minutes from push to live

### Simple Workflow
```bash
git add .
git commit -m "Update portfolio"
git push origin master
# 🎉 Site automatically deploys!
```

📖 **[View detailed deployment documentation](docs/AUTOMATED_DEPLOYMENT.md)**

## 🛠️ Development

### Local Development
```bash
npm install
npm run dev        # Start development server at http://localhost:3000
```

### Manual Deployment
```bash
npm run deploy     # Build and deploy in one command
```

### Validation & Testing
```bash
npm run validate   # HTML validation
npm run build:prod # Production build test
npm run status     # Check build status
```

## 📊 Features

- **Responsive Design**: Mobile-first, adaptive layout
- **Performance Optimized**: Gzipped assets (26KB → 7KB)
- **SEO Ready**: Meta tags, structured data, canonical URLs
- **Modern CSS**: CSS Grid, Flexbox, custom properties
- **Interactive Elements**: Scroll animations, hover effects
- **Link Previews**: Live website previews on hover (desktop)

## 🔧 Technologies

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Fonts**: JetBrains Mono (monospace)
- **Build Tools**: html-minifier-terser, html-validate
- **Deployment**: GitHub Actions, GitHub Pages
- **Performance**: Gzip compression, optimized assets

## 📈 Projects Featured

- **CommitAura**: LLM-powered commit message generation (Rust)
- **XELA Themes**: VSCode theme collection
- **Tessellarity**: WebGPU simulation engine
- **OuterSense**: Real-time gaze tracking system
- **Clippd**: Semantic video analysis pipeline

## 🔍 Monitoring

- **Deployment Status**: [GitHub Actions](https://github.com/cybrdelic/cybrdelic.github.io/actions)
- **Live Site**: [cybrdelic.github.io](https://cybrdelic.github.io)
- **Performance**: Automated Lighthouse testing

---

**Alejandro Figueroa** | Autonomous Systems & Simulation Engineer
*Bridging theoretical research with practical, high-performance applications*
