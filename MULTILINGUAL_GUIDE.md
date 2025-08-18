# Multilingual System Guide

This guide explains how to manage the multilingual (English/Turkish) system in the RSG Turkey website.

## 🌍 Language Switcher

The website includes a language switcher with English and Turkish flags located next to the theme toggle in the header. Users can click the flag to switch between languages.

### Features
- **Visual Flags**: English (Union Jack) and Turkish (Red with crescent and star) flags
- **Smooth Transitions**: Flag opacity changes based on current language
- **URL Routing**: Automatically redirects to language-specific URLs
- **Persistence**: Language preference is saved in localStorage

## 📁 File Structure

```
src/
├── i18n/
│   └── ui.ts                 # Translation keys and functions
├── pages/
│   ├── index.astro          # English homepage
│   ├── about.astro          # English about page
│   ├── blog.astro           # English blog page
│   └── tr/                  # Turkish pages directory
│       ├── index.astro      # Turkish homepage
│       ├── about.astro      # Turkish about page
│       └── blog.astro       # Turkish blog page
├── components/
│   ├── LanguageIcon.astro   # Language switcher component
│   └── Header.astro         # Navigation with language support
└── public/
    └── flags/
        ├── en.svg           # English flag
        └── tr.svg           # Turkish flag
```

## 🔧 How to Add New Translations

### 1. Add Translation Keys

Edit `src/i18n/ui.ts` and add new keys to both English and Turkish sections:

```typescript
export const ui = {
  en: {
    // Existing translations...
    'new.key': 'English text',
  },
  tr: {
    // Existing translations...
    'new.key': 'Türkçe metin',
  },
}
```

### 2. Use Translations in Components

```astro
---
import { getLangFromUrl, useTranslations } from '../i18n/ui';

const lang = getLangFromUrl(Astro.url);
const t = useTranslations(lang);
---

<h1>{t('new.key')}</h1>
```

### 3. Create Language-Specific Pages

For each new page, create both English and Turkish versions:

- English: `src/pages/newpage.astro`
- Turkish: `src/pages/tr/newpage.astro`

## 🌐 URL Structure

- **English pages**: `/about`, `/blog`, `/contact`
- **Turkish pages**: `/tr/about`, `/tr/blog`, `/tr/contact`
- **Homepage**: `/` (English) and `/tr` (Turkish)

## 🎨 Language Detection

The system automatically detects the current language from the URL:

```typescript
// In BaseLayout.astro
const lang = getLangFromUrl(Astro.url);
const t = useTranslations(lang);
```

## 🔗 Navigation Links

All navigation links are automatically updated based on the current language:

```astro
<a href={lang === 'tr' ? '/tr/about' : '/about'}>
  {t('nav.about')}
</a>
```

## 📝 Translation Categories

The translation system is organized into categories:

- **Navigation**: `nav.home`, `nav.about`, etc.
- **Hero Section**: `hero.title`, `hero.description`, etc.
- **Announcements**: `announcements.title`, `announcements.subtitle`, etc.
- **Mission**: `mission.title`, `mission.description`, etc.
- **Statistics**: `stats.years`, `stats.members`, etc.
- **Features**: `features.community.title`, etc.
- **About Page**: `about.title`, `about.whoWeAre.title`, etc.
- **Blog**: `blog.title`, `blog.subtitle`, etc.
- **Contact**: `contact.title`, `contact.form.name`, etc.
- **Join**: `join.title`, `join.form.name`, etc.
- **Footer**: `footer.description`, `footer.quickLinks`, etc.
- **Common**: `common.readMore`, `common.learnMore`, etc.

## 🚀 Adding New Pages

### Step 1: Create English Page
Create the English version first in `src/pages/`.

### Step 2: Create Turkish Page
Create the Turkish version in `src/pages/tr/` with the same filename.

### Step 3: Add Translations
Add all text content to the translation file.

### Step 4: Update Navigation
Add navigation links to the header component.

## 🔄 Language Switching Logic

The language switcher handles URL routing:

```javascript
// Switch to Turkish
if (currentPath === '/') {
  newPath = '/tr';
} else if (currentPath.startsWith('/tr/')) {
  newPath = currentPath; // Already Turkish
} else {
  newPath = '/tr' + currentPath;
}

// Switch to English
if (currentPath === '/tr') {
  newPath = '/';
} else if (currentPath.startsWith('/tr/')) {
  newPath = currentPath.replace('/tr', '');
} else {
  newPath = currentPath; // Already English
}
```

## 🎯 Best Practices

1. **Consistent Naming**: Use descriptive, hierarchical keys like `page.section.element`
2. **Complete Translations**: Always provide both English and Turkish translations
3. **Context-Aware Links**: Use language-aware URL generation for all internal links
4. **SEO Considerations**: Each language version has its own URL for better SEO
5. **Fallback Handling**: The system falls back to English if a translation is missing

## 🔧 Maintenance

- **Regular Updates**: Keep translations synchronized when content changes
- **New Content**: Add translations for all new content
- **Testing**: Test both language versions after updates
- **Consistency**: Maintain consistent terminology across languages

## 📊 Current Status

✅ **Implemented**:
- Language switcher with flags
- URL routing system
- Translation framework
- Navigation language support
- Homepage translations
- Base layout language detection

🔄 **In Progress**:
- Complete page translations (About, Blog, Contact, Join, etc.)
- Content-specific translations
- SEO optimization for both languages

📋 **To Do**:
- Add Turkish versions of all remaining pages
- Translate all content
- Add language-specific meta tags
- Implement language-specific sitemaps
- Add language detection for search engines 