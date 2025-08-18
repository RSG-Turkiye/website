export interface Announcement {
  type: 'event' | 'webinar' | 'workshop' | 'community' | 'career' | 'international';
  date: string;
  title: string;
  description: string;
  primaryAction: {
    text: string;
    url: string;
  };
  secondaryAction?: {
    text: string;
    url: string;
  };
}

export const announcements: Announcement[] = [
  {
    type: 'event',
    date: 'March 15, 2025',
    title: 'Annual Bioinformatics Symposium 2025',
    description: 'Join us for our flagship event featuring keynote speakers, student presentations, and networking opportunities. Registration now open!',
    primaryAction: {
      text: 'Register Now',
      url: '/events'
    },
    secondaryAction: {
      text: 'Learn More',
      url: '/events'
    }
  },
  {
    type: 'webinar',
    date: 'March 20, 2025',
    title: 'Student Research Showcase',
    description: 'Our monthly student presentation series continues with cutting-edge research in computational biology. Open to all community members.',
    primaryAction: {
      text: 'Join Webinar',
      url: '/webinars'
    },
    secondaryAction: {
      text: 'View Schedule',
      url: '/webinars'
    }
  },
  {
    type: 'community',
    date: 'March 25, 2025',
    title: 'New Member Welcome Event',
    description: 'Welcome our newest community members! Join us for an informal networking session and learn about upcoming opportunities.',
    primaryAction: {
      text: 'Join Community',
      url: '/join'
    },
    secondaryAction: {
      text: 'Contact Us',
      url: '/contact'
    }
  },
  {
    type: 'workshop',
    date: 'April 5, 2025',
    title: 'Bioinformatics Tools Workshop',
    description: 'Hands-on workshop on popular bioinformatics tools and pipelines. Perfect for students and early-career researchers.',
    primaryAction: {
      text: 'Register',
      url: '/events'
    },
    secondaryAction: {
      text: 'Resources',
      url: '/resources'
    }
  },
  {
    type: 'career',
    date: 'April 10, 2025',
    title: 'Career Fair 2025',
    description: 'Connect with leading companies and research institutions in computational biology. Great opportunities for internships and jobs.',
    primaryAction: {
      text: 'Attend Fair',
      url: '/events'
    },
    secondaryAction: {
      text: 'Company List',
      url: '/events'
    }
  },
  {
    type: 'international',
    date: 'April 15, 2025',
    title: 'ISCB Student Council Meeting',
    description: 'Representing Turkey at the international ISCB Student Council meeting. Share your ideas and connect with global peers.',
    primaryAction: {
      text: 'Learn More',
      url: '/about'
    },
    secondaryAction: {
      text: 'Get Involved',
      url: '/contact'
    }
  }
]; 