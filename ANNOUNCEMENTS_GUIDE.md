# 📢 Announcements Management Guide

This guide explains how to manage announcements on the RSG Turkey website.

## 🎯 Overview

The announcements section appears prominently on the homepage, right after the hero section. It showcases your latest activities, events, and opportunities for community members to attend.

## 📝 How to Add/Edit Announcements

### 1. Edit the Data File

Open `src/data/announcements.ts` and modify the `announcements` array:

```typescript
export const announcements: Announcement[] = [
  {
    type: 'event', // Choose from: 'event', 'webinar', 'workshop', 'community', 'career', 'international'
    date: 'March 15, 2025',
    title: 'Your Event Title',
    description: 'Brief description of your event or activity',
    primaryAction: {
      text: 'Register Now', // Main call-to-action button text
      url: '/events' // Where the button should link to
    },
    secondaryAction: {
      text: 'Learn More', // Optional secondary button text
      url: '/events' // Where the secondary button should link to
    }
  }
];
```

### 2. Available Announcement Types

- **`event`** - General events, symposiums, conferences
- **`webinar`** - Online presentations, student showcases
- **`workshop`** - Hands-on training sessions
- **`community`** - Member events, networking sessions
- **`career`** - Job fairs, career opportunities
- **`international`** - ISCB meetings, global collaborations

### 3. Best Practices

- **Keep titles concise** - 3-6 words maximum
- **Write clear descriptions** - Explain what attendees will gain
- **Use action-oriented button text** - "Register Now", "Join Webinar", "Learn More"
- **Update dates regularly** - Remove past events or mark them as completed
- **Limit to 6 announcements** - Keep the section focused and not overwhelming

## 🎨 Visual Features

### Automatic Styling
- Each announcement type has its own color-coded badge
- Hover effects with smooth animations
- Responsive design for all devices
- Theme-aware colors (dark/light mode)

### Icons by Type
- 📅 **Event**: Calendar icon
- 🎥 **Webinar**: Video icon  
- 🎓 **Workshop**: Graduation cap icon
- 👥 **Community**: Users icon
- 💼 **Career**: Briefcase icon
- 🌍 **International**: Globe icon

## 📱 Responsive Design

The announcements section automatically adapts to different screen sizes:
- **Desktop**: 3 cards per row
- **Tablet**: 2 cards per row
- **Mobile**: 1 card per row

## 🔄 Adding New Announcement Types

If you need a new announcement type:

1. **Update the TypeScript interface** in `src/data/announcements.ts`:
```typescript
export interface Announcement {
  type: 'event' | 'webinar' | 'workshop' | 'community' | 'career' | 'international' | 'your-new-type';
  // ... rest of interface
}
```

2. **Add the configuration** in `src/components/AnnouncementCard.astro`:
```typescript
const typeConfig = {
  // ... existing types
  'your-new-type': { icon: 'fas fa-your-icon', label: 'Your Label' }
};
```

## 🚀 Quick Start Examples

### Adding a New Event
```typescript
{
  type: 'event',
  date: 'April 20, 2025',
  title: 'Bioinformatics Hackathon',
  description: '24-hour coding challenge focused on solving real-world bioinformatics problems.',
  primaryAction: {
    text: 'Apply Now',
    url: '/events'
  },
  secondaryAction: {
    text: 'View Details',
    url: '/events'
  }
}
```

### Adding a Webinar
```typescript
{
  type: 'webinar',
  date: 'April 25, 2025',
  title: 'Machine Learning in Genomics',
  description: 'Expert presentation on applying ML techniques to genomic data analysis.',
  primaryAction: {
    text: 'Join Webinar',
    url: '/webinars'
  }
}
```

## 📊 Analytics & Tracking

Consider adding tracking to your announcement buttons:
- Use Google Analytics event tracking
- Monitor click-through rates
- Track which types of announcements perform best

## 🎯 Tips for Engagement

1. **Use compelling titles** - Make people want to learn more
2. **Include clear benefits** - What will attendees gain?
3. **Add urgency when appropriate** - "Registration closes soon"
4. **Link to relevant pages** - Don't just link to generic pages
5. **Keep content fresh** - Update regularly to maintain interest

## 🔧 Technical Notes

- Announcements are rendered server-side for optimal performance
- The component automatically handles theme switching
- All styling is responsive and accessible
- TypeScript ensures type safety for all announcement data

---

**Need help?** Contact the website committee for assistance with managing announcements. 