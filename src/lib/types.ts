export type Role = 'admin' | 'editor' | 'reader';
export type PublicationType = 'journal' | 'ebook' | 'research' | 'flipbook' | 'report' | 'magazine';
export type FileType = 'pdf' | 'epub' | 'flipbook';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  affiliation: string | null;
  bio: string | null;
  avatarHue: number;
  status: 'active' | 'suspended';
  createdAt: string;
}

export interface Category {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  accent: string;
  icon: string;
  count?: number;
  sort_order?: number;
}

export interface Tag {
  id: number;
  name: string;
  slug: string;
  count?: number;
}

export interface ReadingProgress {
  progress: number;
  page: number;
  updatedAt?: string;
}

export interface Publication {
  id: number;
  slug: string;
  title: string;
  subtitle: string | null;
  type: PublicationType;
  description: string | null;
  abstract: string | null;
  author: string | null;
  publisher: string | null;
  year: number | null;
  issn: string | null;
  isbn: string | null;
  language: string;
  pages: number;
  category: Pick<Category, 'id' | 'name' | 'slug' | 'accent'> | null;
  coverUrl: string | null;
  fileUrl: string | null;
  fileType: FileType | null;
  fileSize: number;
  excerpt: string | null;
  keywords: { term: string; count: number }[];
  readingMinutes: number;
  status: 'published' | 'draft';
  featured: boolean;
  views: number;
  downloads: number;
  reads: number;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
  tags?: Tag[];
  progress?: ReadingProgress | null;
  bookmarked?: boolean;
  snippet?: string;
  relevance?: number;
  matchedTerms?: string[];
}

export interface SearchResult {
  items: Publication[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  terms?: string[];
  query?: string;
}

export interface Overview {
  stats: {
    titles: number;
    categories: number;
    reads: number;
    downloads: number;
    journals: number;
    ebooks: number;
    keywords: number;
  };
  featured: Publication[];
  latest: Publication[];
  popular: Publication[];
  journals: Publication[];
  categories: Category[];
  keywords: { term: string; count: number }[];
}

export interface Facets {
  authors: { name: string; count: number }[];
  years: { year: number; count: number }[];
  tags: Tag[];
  types: { type: PublicationType; count: number }[];
  languages: { language: string; count: number }[];
  publishers: { name: string; count: number }[];
}

export interface AnalyticsSummary {
  range: { days: number; start: string; end: string };
  totals: { views: number; reads: number; downloads: number; complete: number; activeReaders: number };
  delta: { views: number; reads: number; downloads: number };
  series: { day: string; views: number; reads: number; downloads: number; complete?: number }[];
  topPublications: {
    id: number;
    slug: string;
    title: string;
    author: string | null;
    cover_url: string | null;
    type: string;
    reads: number;
    downloads: number;
    views: number;
    period_events: number;
  }[];
  topDownloads: { id: number; slug: string; title: string; downloads: number }[];
  categorySplit: { id: number; name: string; accent: string; titles: number; reads: number; downloads: number }[];
  recentActivity: {
    type: string;
    created_at: string;
    publication_title: string | null;
    publication_slug: string | null;
    user_name: string | null;
    user_id: number | null;
  }[];
  keywords: { term: string; count: number }[];
  library: {
    published: number;
    drafts: number;
    readers: number;
    allReads: number;
    allDownloads: number;
    allViews: number;
    storage: number;
  };
}

export interface Shelf {
  reading: Publication[];
  saved: Publication[];
}

export interface ReaderContent {
  kind: FileType;
  title: string;
  fileUrl?: string;
  pages?: number | string[];
  chapters?: { id: string; title: string; html: string }[];
}
