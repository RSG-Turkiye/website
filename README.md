
# RSG Turkey Website

A modern, responsive website for RSG Turkey (Regional Student Group Turkey) built with Astro.js. This website serves as the official online presence for the computational biology and bioinformatics community in Turkey.

## 🌟 Features

### 🎨 Modern Design
- **Responsive Design**: Mobile-first approach with Bootstrap 5
- **Professional Aesthetic**: Clean, modern design with bioinformatics theme
- **Dark/Light Theme**: Toggle between light and dark modes
- **Smooth Animations**: Hover effects and transitions for better UX

### 📱 Pages & Content
- **Homepage**: Hero section, mission statement, statistics, and recent content
- **About Us**: Organization information, ISCB affiliation, and committee details
- **Webinars**: Bioinfonet project showcase and webinar archives by year
- **Events**: Symposiums, workshops, and upcoming events
- **Resources**: Educational materials, tools, and external links
- **Contact**: Contact form, FAQ, and social media links
- **Join Us**: Membership information and application form

### 🛠 Technical Features
- **Astro.js**: Fast, modern static site generator
- **Bootstrap 5**: Responsive CSS framework
- **FontAwesome Icons**: Professional iconography
- **TypeScript Support**: Type-safe development
- **SEO Optimized**: Meta tags and structured content
- **Performance Optimized**: Fast loading and optimized assets

## 🚀 Getting Started

### Prerequisites
- Node.js (version 16 or higher)
- npm or yarn package manager

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd website
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start development server**
   ```bash
   npm run dev
   ```

4. **Open your browser**
   Navigate to `http://localhost:4321` to view the website

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run astro` - Run Astro CLI commands

## 📁 Project Structure

```
website/
├── public/                 # Static assets
│   ├── logo/              # Logo files
│   └── favicon.svg        # Site favicon
├── src/
│   ├── components/        # Reusable components
│   │   ├── Header.astro   # Navigation header
│   │   ├── Footer.astro   # Site footer
│   │   └── ...
│   ├── layouts/           # Page layouts
│   │   ├── BaseLayout.astro
│   │   └── CommitteeCard.astro
│   ├── pages/             # Website pages
│   │   ├── index.astro    # Homepage
│   │   ├── about.astro    # About page
│   │   ├── webinars.astro # Webinars page
│   │   ├── events.astro   # Events page
│   │   ├── resources.astro # Resources page
│   │   ├── contact.astro  # Contact page
│   │   └── join.astro     # Join page
│   └── styles/            # Global styles
│       └── global.css     # Main stylesheet
├── astro.config.mjs       # Astro configuration
├── package.json           # Dependencies and scripts
└── tsconfig.json          # TypeScript configuration
```

## 🎨 Design System

### Color Palette
- **Primary Blue**: `#00539F` - Professional, trustworthy
- **Success Green**: `#00d1b2` - Growth, success
- **Background**: `#f8f9fa` (light) / `#212529` (dark)
- **Text**: `#212529` (light) / `#f8f9fa` (dark)

### Typography
- **Font Family**: Roboto (Google Fonts)
- **Headings**: Bootstrap display classes
- **Body Text**: Clean, readable sans-serif

### Components
- **Cards**: Consistent card design with hover effects
- **Buttons**: Bootstrap button styles with custom colors
- **Forms**: Responsive form layouts with validation
- **Navigation**: Dropdown menus and mobile-friendly navigation

## 📝 Content Management

### Adding New Content

#### Blog Posts
1. Create new `.md` files in `src/pages/posts/`
2. Use frontmatter for metadata
3. Content will automatically appear in the blog section

#### Events
1. Update the events array in `src/pages/events.astro`
2. Add event details including date, location, and description
3. Events are automatically categorized and displayed

#### Webinars
1. Update the webinars array in `src/pages/webinars.astro`
2. Add webinar details including presenter, date, and description
3. Webinars are organized by year

### Updating Committee Information
1. Edit the committees array in `src/pages/about.astro`
2. Add member details including role, name, and social media links
3. Committee cards will automatically update

## 🔧 Customization

### Styling
- **Global Styles**: Edit `src/styles/global.css`
- **Component Styles**: Add `<style>` blocks in individual components
- **Bootstrap Customization**: Override Bootstrap variables in CSS

### Configuration
- **Site Title**: Update `pageTitle` in each page
- **Contact Information**: Update email addresses and social media links
- **Logo**: Replace logo files in `public/logo/`

### Adding New Pages
1. Create new `.astro` files in `src/pages/`
2. Import and use `BaseLayout`
3. Add navigation links in `src/components/Header.astro`

## 🌐 Deployment

### Build for Production
```bash
npm run build
```

### Deployment Options
- **Netlify**: Connect repository for automatic deployments
- **Vercel**: Deploy with Vercel CLI or GitHub integration
- **GitHub Pages**: Use GitHub Actions for deployment
- **Traditional Hosting**: Upload `dist/` folder to web server

### Environment Variables
Create a `.env` file for environment-specific configuration:
```env
PUBLIC_SITE_URL=https://rsgturkey.com
PUBLIC_CONTACT_EMAIL=turkey.rsg@gmail.com
```

## 🤝 Contributing

### Development Workflow
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test locally with `npm run dev`
5. Submit a pull request

### Code Style
- Use TypeScript for type safety
- Follow Astro.js best practices
- Maintain consistent formatting
- Add comments for complex logic

## 📞 Support

### Contact Information
- **Email**: turkey.rsg@gmail.com
- **Website**: https://rsgturkey.com
- **ISCB Student Council**: https://www.iscb.org/iscb-student-council

### Issues and Bug Reports
Please report issues through the project's issue tracker or contact the development team directly.

## 📄 License

This project is maintained by RSG Turkey and is part of the ISCB Student Council Regional Student Groups network.

## 🙏 Acknowledgments

- **ISCB Student Council** for support and guidance
- **Bootstrap** for the responsive framework
- **Astro.js** for the modern build system
- **FontAwesome** for the icon library
- **RSG Turkey Community** for content and feedback

---

**RSG Turkey** - Empowering the computational biology community in Turkey through education, collaboration, and innovation.
