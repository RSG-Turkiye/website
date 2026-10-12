/**
 * VideoObject structured data for a webinar page.
 *
 * Search Console listed every webinar page under "Video isn't on a watch
 * page", although the recording is the first thing under the heading. The
 * pages carried only the site-wide Organization JSON-LD, so nothing told
 * Google that the embedded video is what the page is about. This does.
 *
 * Google requires name, thumbnailUrl and uploadDate; description and
 * embedUrl are recommended. The thumbnail is YouTube's own: hqdefault exists
 * for every video, where maxresdefault is missing for older uploads. No
 * inLanguage: the English and Turkish pages embed the same recording, and the
 * page's language says nothing about the talk's.
 */

interface WebinarVideo {
  videoId: string;
  title: string;
  description?: string;
  date: Date;
}

export function videoJsonLd({ videoId, title, description, date }: WebinarVideo) {
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: title,
    description: description || title,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    uploadDate: date.toISOString(),
    embedUrl: `https://www.youtube.com/embed/${videoId}`,
    contentUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}
